const {chromium}=require('playwright');const path=require('path');const fs=require('fs');
(async()=>{const b=await chromium.launch();const p=await b.newPage();const W=1080,H=1080,F=30,D=8.2;
await p.setViewportSize({width:W,height:H});await p.goto('file://'+path.resolve(__dirname,'scene.html'));
const dir=path.resolve(__dirname,'frames');fs.mkdirSync(dir,{recursive:true});
for(let i=0;i<Math.round(F*D);i++){await p.evaluate(([W,H,t])=>render('video',W,H,t),[W,H,i/F]);
await p.screenshot({path:`${dir}/f${String(i).padStart(4,'0')}.jpg`,type:'jpeg',quality:92});}
await b.close();})();
