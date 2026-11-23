//! Native OS file drag-out support (Windows `SHDoDragDrop` + `CF_HDROP` `IDataObject`).

#[cfg(windows)]
mod platform {
    use std::ffi::{c_void, OsStr};
    use std::mem::{size_of, ManuallyDrop};
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::sync::atomic::{AtomicU32, Ordering};
    use tauri::WebviewWindow;
    use windows::core::{IUnknown, IUnknown_Vtbl, Interface, GUID, HRESULT};
    use windows::Win32::Foundation::{
        BOOL, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DV_E_FORMATETC, E_INVALIDARG, E_NOTIMPL,
        E_NOINTERFACE, E_OUTOFMEMORY, E_POINTER, HWND, OLE_E_ADVISENOTSUPPORTED, POINT, S_FALSE,
        S_OK,
    };
    use windows::Win32::System::Com::{
        IAdviseSink, IDataObject, IDataObject_Vtbl, IEnumFORMATETC, IEnumFORMATETC_Vtbl,
        IEnumSTATDATA, DATADIR_GET, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0,
        TYMED_HGLOBAL,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };
    use windows::Win32::System::Ole::{
        OleInitialize, OleUninitialize, CF_HDROP, DROPEFFECT_COPY,
    };
    use windows::Win32::UI::Shell::{SHDoDragDrop, DROPFILES};

    fn hdrop_format_etc() -> FORMATETC {
        FORMATETC {
            cfFormat: CF_HDROP.0,
            ptd: std::ptr::null_mut(),
            dwAspect: DVASPECT_CONTENT.0,
            lindex: -1,
            tymed: TYMED_HGLOBAL.0 as u32,
        }
    }

    fn is_hdrop_format(format: &FORMATETC) -> bool {
        format.cfFormat == CF_HDROP.0
            && (format.dwAspect & DVASPECT_CONTENT.0) != 0
            && (format.tymed & (TYMED_HGLOBAL.0 as u32)) != 0
    }

    fn build_dropfiles_buffer(paths: &[String]) -> Result<Vec<u8>, String> {
        let mut wide_units: Vec<u16> = Vec::new();
        let mut valid_count = 0usize;

        for raw_path in paths {
            let trimmed = raw_path.trim();
            if trimmed.is_empty() {
                continue;
            }
            let normalized = trimmed.replace('/', "\\");
            if !Path::new(&normalized).exists() {
                continue;
            }
            wide_units.extend(OsStr::new(&normalized).encode_wide());
            wide_units.push(0);
            valid_count += 1;
        }

        if valid_count == 0 {
            return Err("没有可拖出的有效文件或目录".to_string());
        }
        wide_units.push(0);

        let header_size = size_of::<DROPFILES>();
        let payload_size = wide_units.len() * size_of::<u16>();
        let mut buffer = vec![0u8; header_size + payload_size];

        let header = DROPFILES {
            pFiles: header_size as u32,
            pt: POINT { x: 0, y: 0 },
            fNC: BOOL(0),
            fWide: BOOL(1),
        };
        unsafe {
            std::ptr::copy_nonoverlapping(
                (&header as *const DROPFILES).cast::<u8>(),
                buffer.as_mut_ptr(),
                header_size,
            );
            std::ptr::copy_nonoverlapping(
                wide_units.as_ptr().cast::<u8>(),
                buffer.as_mut_ptr().add(header_size),
                payload_size,
            );
        }

        Ok(buffer)
    }

    // ---- IEnumFORMATETC COM object ----
    #[repr(C)]
    struct ComEnumFormatEtc {
        vtable: *const IEnumFORMATETC_Vtbl,
        ref_count: AtomicU32,
        index: AtomicU32,
    }

    static ENUM_FORMAT_ETC_VTABLE: IEnumFORMATETC_Vtbl = IEnumFORMATETC_Vtbl {
        base__: IUnknown_Vtbl {
            QueryInterface: enum_query_interface,
            AddRef: enum_add_ref,
            Release: enum_release,
        },
        Next: enum_next,
        Skip: enum_skip,
        Reset: enum_reset,
        Clone: enum_clone,
    };

    impl ComEnumFormatEtc {
        unsafe fn create(index: u32) -> IEnumFORMATETC {
            let boxed = Box::new(Self {
                vtable: &ENUM_FORMAT_ETC_VTABLE,
                ref_count: AtomicU32::new(1),
                index: AtomicU32::new(index),
            });
            let ptr = Box::into_raw(boxed);
            IEnumFORMATETC::from_raw(ptr.cast())
        }
    }

    unsafe extern "system" fn enum_query_interface(
        this: *mut c_void,
        iid: *const GUID,
        ppv: *mut *mut c_void,
    ) -> HRESULT {
        if ppv.is_null() {
            return E_POINTER;
        }
        *ppv = std::ptr::null_mut();
        if iid.is_null() {
            return E_INVALIDARG;
        }
        let iid = *iid;
        if iid == IUnknown::IID || iid == IEnumFORMATETC::IID {
            *ppv = this;
            enum_add_ref(this);
            S_OK
        } else {
            E_NOINTERFACE
        }
    }

    unsafe extern "system" fn enum_add_ref(this: *mut c_void) -> u32 {
        let obj = &*(this.cast::<ComEnumFormatEtc>());
        obj.ref_count.fetch_add(1, Ordering::Relaxed) + 1
    }

    unsafe extern "system" fn enum_release(this: *mut c_void) -> u32 {
        let obj = &*(this.cast::<ComEnumFormatEtc>());
        let prev = obj.ref_count.fetch_sub(1, Ordering::Release);
        if prev == 1 {
            std::sync::atomic::fence(Ordering::Acquire);
            drop(Box::from_raw(this.cast::<ComEnumFormatEtc>()));
        }
        prev - 1
    }

    unsafe extern "system" fn enum_next(
        this: *mut c_void,
        celt: u32,
        rgelt: *mut FORMATETC,
        pceltfetched: *mut u32,
    ) -> HRESULT {
        if celt == 0 {
            if !pceltfetched.is_null() {
                *pceltfetched = 0;
            }
            return S_OK;
        }
        if rgelt.is_null() {
            return E_INVALIDARG;
        }
        let obj = &*(this.cast::<ComEnumFormatEtc>());
        let idx = obj.index.load(Ordering::Relaxed);
        if idx == 0 {
            *rgelt = hdrop_format_etc();
            if !pceltfetched.is_null() {
                *pceltfetched = 1;
            }
            obj.index.store(1, Ordering::Relaxed);
            if celt == 1 {
                S_OK
            } else {
                S_FALSE
            }
        } else {
            if !pceltfetched.is_null() {
                *pceltfetched = 0;
            }
            S_FALSE
        }
    }

    unsafe extern "system" fn enum_skip(this: *mut c_void, celt: u32) -> HRESULT {
        let obj = &*(this.cast::<ComEnumFormatEtc>());
        let next = obj.index.load(Ordering::Relaxed).saturating_add(celt);
        if next <= 1 {
            obj.index.store(next, Ordering::Relaxed);
            S_OK
        } else {
            obj.index.store(1, Ordering::Relaxed);
            S_FALSE
        }
    }

    unsafe extern "system" fn enum_reset(this: *mut c_void) -> HRESULT {
        let obj = &*(this.cast::<ComEnumFormatEtc>());
        obj.index.store(0, Ordering::Relaxed);
        S_OK
    }

    unsafe extern "system" fn enum_clone(
        this: *mut c_void,
        ppenum: *mut *mut c_void,
    ) -> HRESULT {
        if ppenum.is_null() {
            return E_POINTER;
        }
        let obj = &*(this.cast::<ComEnumFormatEtc>());
        let cloned = ComEnumFormatEtc::create(obj.index.load(Ordering::Relaxed));
        *ppenum = cloned.into_raw();
        S_OK
    }

    // ---- IDataObject COM object ----
    #[repr(C)]
    struct ComFileDataObject {
        vtable: *const IDataObject_Vtbl,
        ref_count: AtomicU32,
        dropfiles_bytes: Vec<u8>,
    }

    static DATA_OBJECT_VTABLE: IDataObject_Vtbl = IDataObject_Vtbl {
        base__: IUnknown_Vtbl {
            QueryInterface: data_query_interface,
            AddRef: data_add_ref,
            Release: data_release,
        },
        GetData: data_get_data,
        GetDataHere: data_get_data_here,
        QueryGetData: data_query_get_data,
        GetCanonicalFormatEtc: data_get_canonical_format_etc,
        SetData: data_set_data,
        EnumFormatEtc: data_enum_format_etc,
        DAdvise: data_dadvise,
        DUnadvise: data_dunadvise,
        EnumDAdvise: data_enum_dadvise,
    };

    impl ComFileDataObject {
        unsafe fn create(dropfiles_bytes: Vec<u8>) -> IDataObject {
            let boxed = Box::new(Self {
                vtable: &DATA_OBJECT_VTABLE,
                ref_count: AtomicU32::new(1),
                dropfiles_bytes,
            });
            let ptr = Box::into_raw(boxed);
            IDataObject::from_raw(ptr.cast())
        }
    }

    unsafe extern "system" fn data_query_interface(
        this: *mut c_void,
        iid: *const GUID,
        ppv: *mut *mut c_void,
    ) -> HRESULT {
        if ppv.is_null() {
            return E_POINTER;
        }
        *ppv = std::ptr::null_mut();
        if iid.is_null() {
            return E_INVALIDARG;
        }
        let iid = *iid;
        if iid == IUnknown::IID || iid == IDataObject::IID {
            *ppv = this;
            data_add_ref(this);
            S_OK
        } else {
            E_NOINTERFACE
        }
    }

    unsafe extern "system" fn data_add_ref(this: *mut c_void) -> u32 {
        let obj = &*(this.cast::<ComFileDataObject>());
        obj.ref_count.fetch_add(1, Ordering::Relaxed) + 1
    }

    unsafe extern "system" fn data_release(this: *mut c_void) -> u32 {
        let obj = &*(this.cast::<ComFileDataObject>());
        let prev = obj.ref_count.fetch_sub(1, Ordering::Release);
        if prev == 1 {
            std::sync::atomic::fence(Ordering::Acquire);
            drop(Box::from_raw(this.cast::<ComFileDataObject>()));
        }
        prev - 1
    }

    unsafe extern "system" fn data_get_data(
        this: *mut c_void,
        pformatetcin: *const FORMATETC,
        pmedium: *mut STGMEDIUM,
    ) -> HRESULT {
        if pmedium.is_null() {
            return E_POINTER;
        }
        let Some(format) = pformatetcin.as_ref() else {
            return E_INVALIDARG;
        };
        if !is_hdrop_format(format) {
            return DV_E_FORMATETC;
        }
        let obj = &*(this.cast::<ComFileDataObject>());
        let Ok(hglobal) = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, obj.dropfiles_bytes.len())
        else {
            return E_OUTOFMEMORY;
        };
        let locked = GlobalLock(hglobal);
        if locked.is_null() {
            return E_OUTOFMEMORY;
        }
        std::ptr::copy_nonoverlapping(
            obj.dropfiles_bytes.as_ptr(),
            locked.cast::<u8>(),
            obj.dropfiles_bytes.len(),
        );
        let _ = GlobalUnlock(hglobal);

        *pmedium = STGMEDIUM {
            tymed: TYMED_HGLOBAL.0 as u32,
            u: STGMEDIUM_0 { hGlobal: hglobal },
            pUnkForRelease: ManuallyDrop::new(None),
        };
        S_OK
    }

    unsafe extern "system" fn data_get_data_here(
        _this: *mut c_void,
        _pformatetc: *const FORMATETC,
        _pmedium: *mut STGMEDIUM,
    ) -> HRESULT {
        E_NOTIMPL
    }

    unsafe extern "system" fn data_query_get_data(
        _this: *mut c_void,
        pformatetc: *const FORMATETC,
    ) -> HRESULT {
        let Some(format) = pformatetc.as_ref() else {
            return E_INVALIDARG;
        };
        if is_hdrop_format(format) {
            S_OK
        } else {
            DV_E_FORMATETC
        }
    }

    unsafe extern "system" fn data_get_canonical_format_etc(
        _this: *mut c_void,
        _pformatectin: *const FORMATETC,
        pformatetcout: *mut FORMATETC,
    ) -> HRESULT {
        if !pformatetcout.is_null() {
            (*pformatetcout).ptd = std::ptr::null_mut();
        }
        E_NOTIMPL
    }

    unsafe extern "system" fn data_set_data(
        _this: *mut c_void,
        _pformatetc: *const FORMATETC,
        _pmedium: *const STGMEDIUM,
        _frelease: BOOL,
    ) -> HRESULT {
        E_NOTIMPL
    }

    unsafe extern "system" fn data_enum_format_etc(
        _this: *mut c_void,
        dwdirection: u32,
        ppenumformatetc: *mut *mut c_void,
    ) -> HRESULT {
        if ppenumformatetc.is_null() {
            return E_POINTER;
        }
        *ppenumformatetc = std::ptr::null_mut();
        if dwdirection == DATADIR_GET.0 as u32 {
            let enumerator = ComEnumFormatEtc::create(0);
            *ppenumformatetc = enumerator.into_raw();
            S_OK
        } else {
            E_NOTIMPL
        }
    }

    unsafe extern "system" fn data_dadvise(
        _this: *mut c_void,
        _pformatetc: *const FORMATETC,
        _advf: u32,
        _padvsink: *mut c_void,
        _pdwconnection: *mut u32,
    ) -> HRESULT {
        let _ = std::ptr::null::<IAdviseSink>();
        OLE_E_ADVISENOTSUPPORTED
    }

    unsafe extern "system" fn data_dunadvise(
        _this: *mut c_void,
        _dwconnection: u32,
    ) -> HRESULT {
        OLE_E_ADVISENOTSUPPORTED
    }

    unsafe extern "system" fn data_enum_dadvise(
        _this: *mut c_void,
        _ppenumadvise: *mut *mut c_void,
    ) -> HRESULT {
        let _ = std::ptr::null::<IEnumSTATDATA>();
        OLE_E_ADVISENOTSUPPORTED
    }

    pub async fn start_external_file_drag(
        window: WebviewWindow,
        paths: Vec<String>,
    ) -> Result<bool, String> {
        let dropfiles_bytes = build_dropfiles_buffer(&paths)?;
        let hwnd_raw = window
            .hwnd()
            .map(|hwnd| hwnd.0 as isize)
            .unwrap_or(0);
        let (tx, rx) = tokio::sync::oneshot::channel();

        window
            .run_on_main_thread(move || {
                let result = unsafe {
                    let ole_ok = OleInitialize(None).is_ok();
                    let data_object = ComFileDataObject::create(dropfiles_bytes);
                    let drag_hr = SHDoDragDrop(
                        HWND(hwnd_raw as *mut c_void),
                        &data_object,
                        None,
                        DROPEFFECT_COPY,
                    );
                    if ole_ok {
                        OleUninitialize();
                    }
                    match drag_hr {
                        Ok(_) => Ok(true),
                        Err(err) => {
                            let code = err.code();
                            if code == DRAGDROP_S_DROP {
                                Ok(true)
                            } else if code == DRAGDROP_S_CANCEL || code == S_OK {
                                Ok(false)
                            } else {
                                Err(format!("系统拖拽失败: {err}"))
                            }
                        }
                    }
                };
                let _ = tx.send(result);
            })
            .map_err(|e| format!("无法在主线程启动拖拽: {e}"))?;

        rx.await.map_err(|_| "系统拖拽任务已取消".to_string())?
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::WebviewWindow;

    pub async fn start_external_file_drag(
        _window: WebviewWindow,
        _paths: Vec<String>,
    ) -> Result<bool, String> {
        Ok(false)
    }
}

pub use platform::start_external_file_drag;
