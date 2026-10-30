use serde::Serialize;

#[derive(Serialize)]
struct DesktopInfo {
    backend_url: String,
}

fn valid_secret_name(name: &str) -> bool {
    name == "session-token"
        || (name.starts_with("room-pass-")
            && name.len() == 16
            && name[10..].chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit()))
}

#[cfg(windows)]
mod credential_store {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Security::Credentials::{
        CredDeleteW, CredFree, CredReadW, CredWriteW, CREDENTIALW,
        CRED_PERSIST_LOCAL_MACHINE, CRED_TYPE_GENERIC,
    };

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value).encode_wide().chain(Some(0)).collect()
    }

    pub fn get(name: &str) -> Result<Option<String>, String> {
        let target = wide(&format!("VaultRoom/{name}"));
        let mut credential = std::ptr::null_mut();
        let found = unsafe { CredReadW(target.as_ptr(), CRED_TYPE_GENERIC, 0, &mut credential) };
        if found == 0 {
            return Ok(None);
        }
        let item = unsafe { &*credential };
        let bytes = unsafe {
            std::slice::from_raw_parts(item.CredentialBlob, item.CredentialBlobSize as usize)
        };
        let value = String::from_utf8(bytes.to_vec())
            .map_err(|_| "Credential data is invalid".to_string());
        unsafe { CredFree(credential.cast()) };
        value.map(Some)
    }

    pub fn set(name: &str, value: &str) -> Result<(), String> {
        let target = wide(&format!("VaultRoom/{name}"));
        let username = wide("VaultRoom");
        let mut blob = value.as_bytes().to_vec();
        let credential = CREDENTIALW {
            Flags: 0,
            Type: CRED_TYPE_GENERIC,
            TargetName: target.as_mut_ptr(),
            Comment: std::ptr::null_mut(),
            LastWritten: Default::default(),
            CredentialBlobSize: blob.len() as u32,
            CredentialBlob: blob.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            AttributeCount: 0,
            Attributes: std::ptr::null_mut(),
            TargetAlias: std::ptr::null_mut(),
            UserName: username.as_mut_ptr(),
        };
        let result = unsafe { CredWriteW(&credential, 0) };
        blob.fill(0);
        if result == 0 {
            Err("Windows Credential Manager could not save this session".to_string())
        } else {
            Ok(())
        }
    }

    pub fn delete(name: &str) -> Result<(), String> {
        let target = wide(&format!("VaultRoom/{name}"));
        let result = unsafe { CredDeleteW(target.as_ptr(), CRED_TYPE_GENERIC, 0) };
        // ERROR_NOT_FOUND means the requested secret is already absent.
        if result != 0 || unsafe { windows_sys::Win32::Foundation::GetLastError() } == 1168 {
            Ok(())
        } else {
            Err("Windows Credential Manager could not remove this session".to_string())
        }
    }
}

#[tauri::command]
fn secure_get_secret(name: String) -> Result<Option<String>, String> {
    if !valid_secret_name(&name) {
        return Err("Unsupported credential name".to_string());
    }
    #[cfg(windows)]
    { credential_store::get(&name) }
    #[cfg(not(windows))]
    { let _ = name; Err("Secure credential storage is currently supported on Windows only".to_string()) }
}

#[tauri::command]
fn secure_set_secret(name: String, value: String) -> Result<(), String> {
    // Generic Windows credentials have a 2,560-byte blob limit.
    if !valid_secret_name(&name) || value.len() > 2_500 {
        return Err("Unsupported credential or credential is too large".to_string());
    }
    #[cfg(windows)]
    { credential_store::set(&name, &value) }
    #[cfg(not(windows))]
    { let _ = (name, value); Err("Secure credential storage is currently supported on Windows only".to_string()) }
}

#[tauri::command]
fn secure_delete_secret(name: String) -> Result<(), String> {
    if !valid_secret_name(&name) {
        return Err("Unsupported credential name".to_string());
    }
    #[cfg(windows)]
    { credential_store::delete(&name) }
    #[cfg(not(windows))]
    { let _ = name; Err("Secure credential storage is currently supported on Windows only".to_string()) }
}

#[tauri::command]
fn desktop_info() -> DesktopInfo {
    DesktopInfo { backend_url: "https://cipher-vault-room.onrender.com".to_string() }
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            secure_get_secret,
            secure_set_secret,
            secure_delete_secret,
            desktop_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VaultRoom desktop client");
}
