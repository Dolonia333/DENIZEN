import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 820 }, deviceScaleFactor: 2 });
await p.goto('http://localhost:8080/tools/room-preview.html?fresh='+Date.now(),{waitUntil:'networkidle'});
await p.waitForTimeout(3500);
// Clip to the break_room (brown) room — top-middle area
await p.screenshot({ path:'assets/_shot.png', clip:{ x:650, y:60, width:320, height:230 } });
await b.close(); console.log('done');
