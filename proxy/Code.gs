// Google Apps Script - MangaDex CORS Proxy
// DEPLOY: script.google.com → New Project → Paste all this → Deploy → Web App → Anyone can access → Deploy
// Copy the URL it gives you and paste it in mangareader.html as PROXY_URL

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  var p = e.parameter;
  var targetUrl = p.url;

  if (!targetUrl) {
    return ContentService.createTextOutput(JSON.stringify({error: "Missing ?url="})).setMimeType(ContentService.MimeType.JSON);
  }
  if (targetUrl.indexOf("api.mangadex.org") === -1) {
    return ContentService.createTextOutput(JSON.stringify({error: "Only MangaDex"})).setMimeType(ContentService.MimeType.JSON);
  }

  try {
    var r = UrlFetchApp.fetch(targetUrl, { muteHttpExceptions: true, headers: { "User-Agent": "Mozilla/5.0" } });
    return ContentService.createTextOutput(r.getContentText()).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({error: err.toString()})).setMimeType(ContentService.MimeType.JSON);
  }
}
