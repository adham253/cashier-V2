// Google Apps Script optional cloud backup for the offline cashier.
// 1) Create a Google Sheet, then Extensions > Apps Script.
// 2) Paste this code, save, Deploy > New deployment > Web app.
// 3) Execute as: Me. Who has access: Anyone with the link.
// 4) Copy the /exec URL into the app: More > Cloud Sync.

const SPREADSHEET_ID = 'PUT_YOUR_GOOGLE_SHEET_ID_HERE';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sh = ss.getSheetByName('POS_EVENTS');
    if (!sh) {
      sh = ss.insertSheet('POS_EVENTS');
      sh.appendRow(['received_at','device_id','event_id','event_type','event_created_at','payload_json']);
    }
    const rows = (body.events || []).map(ev => [new Date(), body.deviceId || '', ev.id || '', ev.eventType || '', ev.createdAt || '', JSON.stringify(ev.payload || {})]);
    if (rows.length) sh.getRange(sh.getLastRow()+1,1,rows.length,6).setValues(rows);
    return ContentService.createTextOutput(JSON.stringify({ok:true,received:rows.length})).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ok:false,error:String(err)})).setMimeType(ContentService.MimeType.JSON);
  }
}
