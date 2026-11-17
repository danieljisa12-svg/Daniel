const {chromium}=require('playwright');const path=require('path');
(async()=>{const b=await chromium.launch();const p=await b.newPage();
await p.goto('file://'+path.resolve(__dirname,'scene.html'));
const out=path.resolve(__dirname,'../media');
const list=process.argv[2]?process.argv[2].split(','):['packshot','hero','split','levels','battery','gift','pocket'];
for(const n of list){const W=2000,H=2000;await p.setViewportSize({width:W,height:H});
 await p.evaluate(([n,W,H])=>render(n,W,H,0),[n,W,H]);await p.screenshot({path:`${out}/${n}.png`,clip:{x:0,y:0,width:W,height:H}});console.log(n);}
await b.close();})();
