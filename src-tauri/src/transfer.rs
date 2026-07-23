use std::{collections::HashMap, sync::Mutex};
use tauri::State;

#[derive(Default)]
pub struct TabTransferState {
    payloads: Mutex<HashMap<String, String>>,
}

#[tauri::command]
pub fn put_tab_transfer(
    state: State<'_, TabTransferState>,
    transfer_id: String,
    payload: String,
) -> Result<(), String> {
    let transfer_id = transfer_id.trim().to_string();
    if transfer_id.is_empty() {
        return Err("transfer id 不能为空".to_string());
    }

    state
        .payloads
        .lock()
        .map_err(|error| error.to_string())?
        .insert(transfer_id, payload);
    Ok(())
}

#[tauri::command]
pub fn take_tab_transfer(
    state: State<'_, TabTransferState>,
    transfer_id: String,
) -> Result<Option<String>, String> {
    Ok(state
        .payloads
        .lock()
        .map_err(|error| error.to_string())?
        .remove(transfer_id.trim()))
}

#[tauri::command]
pub fn clear_tab_transfer(
    state: State<'_, TabTransferState>,
    transfer_id: String,
) -> Result<(), String> {
    state
        .payloads
        .lock()
        .map_err(|error| error.to_string())?
        .remove(transfer_id.trim());
    Ok(())
}
