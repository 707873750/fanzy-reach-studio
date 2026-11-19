const status = document.querySelector('#status');
async function display() { const data = await chrome.storage.local.get('status'); status.textContent = data.status || '尚未连接'; }
chrome.storage.onChanged.addListener(display);
document.querySelector('#connect').onclick = async () => {
  const button = document.querySelector('#connect'); button.disabled = true;
  try {
    const config = JSON.parse(document.querySelector('#pairing').value);
    const result = await chrome.runtime.sendMessage({action:'pair', config});
    if (!result.ok) throw Error(result.error);
    document.querySelector('#pairing').value = '';
  } catch (error) { status.textContent = error.message; }
  finally { button.disabled = false; }
};
document.querySelector('#disconnect').onclick = async () => {
  const result = await chrome.runtime.sendMessage({action:'disconnect'});
  if (!result.ok) status.textContent = result.error;
};
void display();
