use std::time::Duration;

use futures_util::{stream::FuturesUnordered, StreamExt};
use semver::Version;
use serde::Serialize;
use tauri::{Manager, ResourceId, Runtime, Url, Webview};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::network_proxy::{resolve_network_proxy, NetworkProxySettings};

const CHECK_TIMEOUT: Duration = Duration::from_secs(6);
const DOWNLOAD_READ_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    body: Option<String>,
    raw_json: serde_json::Value,
    host: String,
    alternate: Option<(ResourceId, String)>,
}

// 两端发布脚本分别保留 Krosna 和 Termflow 的安装包文件名。只为已知的平台和
// 精确匹配的发布地址生成备用地址；版本及签名始终取自同一个 Update。
fn alternate_windows_url(url: &Url, version: &Version) -> Option<Url> {
    let github = format!("https://github.com/2642475449/Krosna/releases/download/v{version}/Krosna_{version}_x64-setup.exe");
    let mirror =
        format!("https://termflow.jianglan.online/releases/Termflow_{version}_x64-setup.exe");
    if url.as_str() == github {
        Url::parse(&mirror).ok()
    } else if url.as_str() == mirror {
        Url::parse(&github).ok()
    } else {
        None
    }
}

// 输入顺序是清单实际返回的顺序，同版本取先响应的一方。有效的旧清单不能掩盖另一个源的新版本。
fn rank_releases<T>(
    results: impl IntoIterator<Item = Result<Option<(Version, T)>, String>>,
) -> Result<Vec<(Version, T)>, String> {
    let mut available = Vec::new();
    let mut up_to_date = false;
    let mut errors = Vec::new();
    for result in results {
        match result {
            Ok(Some(update)) => available.push(update),
            Ok(None) => up_to_date = true,
            Err(error) => errors.push(error),
        }
    }
    if available.is_empty() && !up_to_date {
        return Err(if errors.is_empty() {
            "No update sources configured".into()
        } else {
            errors.join("\n")
        });
    }
    available.sort_by(|(a, _), (b, _)| b.cmp_precedence(a));
    Ok(available)
}

pub async fn check_update_sources<R: Runtime>(
    app: &tauri::AppHandle<R>,
    settings: &NetworkProxySettings,
) -> Result<Option<(Update, Option<Update>)>, String> {
    let config = app
        .config()
        .plugins
        .0
        .get("updater")
        .ok_or("Missing updater configuration")?;
    let endpoints: Vec<Url> = serde_json::from_value(config["endpoints"].clone())
        .map_err(|error| format!("Invalid updater endpoints: {error}"))?;
    let resolved = resolve_network_proxy(settings)?;
    let proxy = resolved
        .https_proxy
        .or(resolved.http_proxy)
        .map(|url| {
            updater_http::Proxy::all(url)
                .map(|proxy| proxy.no_proxy(updater_http::NoProxy::from_string(&resolved.no_proxy)))
        })
        .transpose()
        .map_err(|_| "Invalid update proxy configuration")?;
    let disable_proxy = resolved.mode == "disabled";
    let checks = FuturesUnordered::new();
    for endpoint in endpoints {
        let source = endpoint.host_str().unwrap_or_default().to_owned();
        let proxy = proxy.clone();
        let updater = app
            .updater_builder()
            .endpoints(vec![endpoint])
            .and_then(|builder| {
                builder
                    .timeout(CHECK_TIMEOUT)
                    .configure_client(move |client| {
                        let client = client
                            .connect_timeout(CHECK_TIMEOUT)
                            .read_timeout(DOWNLOAD_READ_TIMEOUT);
                        if let Some(proxy) = &proxy {
                            client.proxy(proxy.clone())
                        } else if disable_proxy {
                            client.no_proxy()
                        } else {
                            client
                        }
                    })
                    .build()
            })
            .map_err(|error| error.to_string())?;
        checks.push(async move {
            let result = updater
                .check()
                .await
                .map_err(|error| format!("{source}: {error}"))?;
            result
                .map(|update| {
                    Version::parse(&update.version)
                        .map(|version| (version, update))
                        .map_err(|error| format!("{source}: {error}"))
                })
                .transpose()
        });
    }
    let mut available = rank_releases(checks.collect::<Vec<_>>().await)?.into_iter();
    let Some((version, primary)) = available.next() else {
        return Ok(None);
    };
    let alternate = available
        .find_map(|(_, update)| {
            (primary.version == update.version
                && primary.signature == update.signature
                && primary.download_url != update.download_url)
                .then_some(update)
        })
        .or_else(|| {
            let url = alternate_windows_url(&primary.download_url, &version)?;
            let mut alternate = primary.clone();
            alternate.download_url = url;
            Some(alternate)
        });
    Ok(Some((primary, alternate)))
}

#[tauri::command]
pub async fn check_application_update<R: Runtime>(
    webview: Webview<R>,
    settings: NetworkProxySettings,
) -> Result<Option<UpdateMetadata>, String> {
    let Some((update, alternate)) = check_update_sources(webview.app_handle(), &settings).await?
    else {
        return Ok(None);
    };
    let mut resources = webview.resources_table();
    Ok(Some(UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        host: update.download_url.host_str().unwrap_or_default().into(),
        rid: resources.add(update),
        alternate: alternate.map(|update| {
            let host = update.download_url.host_str().unwrap_or_default().into();
            (resources.add(update), host)
        }),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranks_newer_releases_first_and_breaks_ties_by_response_order() {
        let newer = Version::new(1, 0, 10);
        let stale = Version::new(1, 0, 9);
        let result = rank_releases([
            Ok(None),
            Ok(Some((stale.clone(), "stale"))),
            Ok(Some((newer.clone(), "first"))),
            Ok(Some((newer.clone(), "second"))),
        ])
        .unwrap();
        assert_eq!(
            result,
            [
                (newer.clone(), "first"),
                (newer, "second"),
                (stale, "stale")
            ]
        );
    }

    #[test]
    fn a_source_error_only_fails_the_check_when_no_source_succeeded() {
        let update = (Version::new(1, 0, 10), "healthy");
        assert_eq!(
            rank_releases([Err("offline".into()), Ok(Some(update.clone()))]).unwrap(),
            [update]
        );
        assert!(rank_releases::<()>([Err("offline".into()), Ok(None)])
            .unwrap()
            .is_empty());
        assert_eq!(
            rank_releases::<()>([Err("primary".into()), Err("mirror".into())]),
            Err("primary\nmirror".into())
        );
    }

    #[test]
    fn windows_fallback_is_pinned_to_the_same_release_in_both_directions() {
        let version = Version::new(1, 8, 38);
        let github = Url::parse("https://github.com/2642475449/Krosna/releases/download/v1.8.38/Krosna_1.8.38_x64-setup.exe").unwrap();
        let mirror =
            Url::parse("https://termflow.jianglan.online/releases/Termflow_1.8.38_x64-setup.exe")
                .unwrap();
        assert_eq!(
            alternate_windows_url(&github, &version).as_ref(),
            Some(&mirror)
        );
        assert_eq!(
            alternate_windows_url(&mirror, &version).as_ref(),
            Some(&github)
        );
        assert_eq!(
            alternate_windows_url(&github, &Version::new(1, 8, 39)),
            None
        );
        let other =
            Url::parse("https://termflow.jianglan.online/releases/Termflow_1.8.38_arm64-setup.exe")
                .unwrap();
        assert_eq!(alternate_windows_url(&other, &version), None);
    }
}
