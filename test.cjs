const fs = require('fs');
const path = 'C:/Users/USER/.gemini/antigravity-ide/brain/1d6015db-e856-45e9-9ab2-8d037d62d6f7/.system_generated/logs/transcript_full.jsonl';
const lines = fs.readFileSync(path, 'utf8').split('\n');
for (let i = 0; i < lines.length; i++) {
  if (!lines[i]) continue;
  try {
    const obj = JSON.parse(lines[i]);
    if (obj.tool_calls) {
      for (const call of obj.tool_calls) {
        if (call.name.includes('replace')) {
          console.log(call.name);
          break;
        }
      }
    }
  } catch(e) {}
}
