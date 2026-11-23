const C = JSON.parse(document.getElementById("chart-data").textContent);
console.info("BKNG earnings robustness charts", Object.keys(C).length);
document.fonts.ready.then(()=>{
const SS="'Source Sans Pro'",soft='rgba(27,26,23,.55)',grid='rgba(156,149,138,.3)';
const navy='rgba(61,79,111,.9)',navyL='rgba(61,79,111,.45)',rust='#B86B3C',rustL='rgba(184,107,60,.45)',sand='rgba(156,149,138,.75)',ink='rgba(27,26,23,.8)',olive='rgba(107,122,74,.85)';
Chart.defaults.font.family=SS;Chart.defaults.font.size=13;Chart.defaults.color=soft;Chart.defaults.animation=false;
const leg={position:'bottom',labels:{boxWidth:12,boxHeight:12,padding:14,font:{family:SS,size:13,weight:'600'},color:'rgba(27,26,23,.7)'}};
const X={grid:{display:false},border:{display:false},ticks:{maxRotation:0,autoSkip:true,font:{weight:'600'}}};
const XA={grid:{display:false},border:{display:false},ticks:{maxRotation:0,autoSkip:false,font:{weight:'600',size:12},callback:function(v){const l=this.getLabelForValue(v);return l.startsWith('TTM')?['TTM',l.slice(4)]:l}}};
const Xyear={grid:{display:false},border:{display:false},ticks:{maxRotation:0,autoSkip:false,font:{weight:'600',size:12},callback:function(v){const l=this.getLabelForValue(v);return l.endsWith('Q1')?l.slice(0,4):''}}};
const Y=(cb,extra)=>Object.assign({border:{display:false},grid:{color:grid,drawTicks:false},ticks:{padding:6,callback:cb}},extra||{});
const base=(o)=>Object.assign({responsive:true,maintainAspectRatio:false,plugins:{legend:leg,tooltip:{enabled:true}}},o);
const mk=(id,cfg)=>{const el=document.getElementById(id);if(!el)return;const chartType=cfg.type;(cfg.data.datasets||[]).forEach(ds=>{if((ds.type||chartType)==='line')ds.spanGaps=false;});new Chart(el,cfg)};
const B=v=>'$'+v+'B',P=v=>v+'%';
mk('c_inc',{type:'bar',data:{labels:C.inc.labels,datasets:[
 {label:'Revenue',data:C.inc.rev,backgroundColor:navy,stack:'r'},
 {label:'FTC add-back',data:C.inc.rev.map((v,i)=>C.inc.rev_adj[i]==null?null:+(C.inc.rev_adj[i]-v).toFixed(2)),backgroundColor:'rgba(255,254,251,1)',borderColor:navy,borderWidth:1.5,borderDash:[4,3],stack:'r'},
 {label:'Operating income',data:C.inc.oi,backgroundColor:rust,stack:'o'},
 {label:'FTC add-back (op. income)',data:C.inc.oi.map((v,i)=>C.inc.oi_adj[i]==null?null:+(C.inc.oi_adj[i]-v).toFixed(2)),backgroundColor:'rgba(255,254,251,1)',borderColor:rust,borderWidth:1.5,stack:'o'},
 {label:'Net income',data:C.inc.ni,backgroundColor:sand,stack:'n'},
]},options:base({plugins:{legend:Object.assign({},leg,{labels:Object.assign({},leg.labels,{filter:i=>!i.text.startsWith('FTC add-back (')})})},scales:{x:Object.assign({stacked:true},XA),y:Y(B,{stacked:true})}})});
mk('c_qg',{type:'line',data:{labels:C.qg.labels,datasets:[
 {label:'Room nights',data:C.qg.rn,borderColor:navy,backgroundColor:navy,borderWidth:2.5,pointRadius:2.5,tension:0},
 {label:'Gross bookings',data:C.qg.gbv,borderColor:rust,backgroundColor:rust,borderWidth:2.5,pointRadius:2.5,tension:0},
 {label:'Revenue (GAAP)',data:C.qg.rev,borderColor:sand,backgroundColor:sand,borderWidth:2,pointRadius:2.5,tension:0},
 {label:'Adj. revenue Q3 ’26',data:C.qg.rev_adj,borderColor:ink,backgroundColor:ink,pointRadius:6,pointStyle:'rectRot',showLine:false},
]},options:base({scales:{x:X,y:Y(P)}})});
mk('c_take',{type:'line',data:{labels:C.take.labels,datasets:[
 {label:'Take rate',data:C.take.take,borderColor:navy,backgroundColor:navy,borderWidth:2.5,pointRadius:3}]},
 options:base({scales:{x:XA,y:Y(P,{min:12,max:22})}})});
mk('c_merch',{type:'line',data:{labels:C.take.labels,datasets:[
 {label:'Merchant share of gross bookings',data:C.take.merch,borderColor:rust,backgroundColor:rust,borderWidth:2.5,pointRadius:3}]},
 options:base({scales:{x:XA,y:Y(P,{min:0,max:80})}})});
mk('c_mix',{type:'bar',data:{labels:C.mix.labels,datasets:[
 {label:'Merchant',data:C.mix.mer,backgroundColor:navy},{label:'Agency',data:C.mix.ag,backgroundColor:sand},{label:'Advertising & other',data:C.mix.ad,backgroundColor:rust}]},
 options:base({scales:{x:Object.assign({stacked:true},XA),y:Y(B,{stacked:true})}})});
mk('c_dec',{type:'bar',data:{labels:C.dec.labels,datasets:[
 {label:'Profit growth',data:C.dec.profit,backgroundColor:navy,stack:'s'},
 {label:'Share-count reduction',data:C.dec.share,backgroundColor:rust,stack:'s'}]},
 options:base({scales:{x:Object.assign({stacked:true},XA),y:Y(P,{stacked:true})}}),
 plugins:[{id:'tot',afterDatasetsDraw(c){const g=c.ctx,m=c.getDatasetMeta(1);g.save();g.font="700 13px "+SS;g.fillStyle='rgba(27,26,23,.75)';g.textAlign='center';
 m.data.forEach((b,i)=>{if(C.dec.tot[i]==null)return;g.fillText('+'+C.dec.tot[i]+'%',b.x,b.y-6)});g.restore();}}]});
mk('c_eps',{type:'bar',data:{labels:C.eps.labels,datasets:[
 {label:'Adjusted EPS',data:C.eps.adj,backgroundColor:navy},
 {label:'GAAP diluted EPS',data:C.eps.gaap,backgroundColor:sand}]},
 options:base({scales:{x:XA,y:Y(v=>'$'+v)}})});
mk('c_was',{type:'line',data:{labels:C.eps.labels,datasets:[
 {label:'Diluted shares (millions)',data:C.eps.was,borderColor:rust,backgroundColor:rust,borderWidth:2.5,pointRadius:3}]},
 options:base({scales:{x:XA,y:Y(v=>v+'M',{min:600,max:1400})}})});
mk('c_ret',{type:'bar',data:{labels:C.ret.labels,datasets:[
 {label:'Buybacks',data:C.ret.bb,backgroundColor:navy,stack:'r'},{label:'Dividends',data:C.ret.div,backgroundColor:rustL,stack:'r'},
 {label:'Free cash flow',data:C.ret.fcf,type:'line',borderColor:ink,backgroundColor:ink,borderWidth:2,pointRadius:3}]},
 options:base({scales:{x:Object.assign({stacked:true},XA),y:Y(B,{stacked:true})}})});
mk('c_fcf',{type:'bar',data:{labels:C.fcf.labels,datasets:[
 {label:'Free cash flow',data:C.fcf.fcf,backgroundColor:navy},
 {label:'FCF ex working-capital swing',data:C.fcf.exwc,backgroundColor:sand}]},
 options:base({scales:{x:XA,y:Y(B)}})});
mk('c_conv',{type:'line',data:{labels:C.fcf.labels,datasets:[
 {label:'FCF ÷ net income',data:C.fcf.conv,borderColor:rust,backgroundColor:rust,borderWidth:2.5,pointRadius:3,spanGaps:false}]},
 options:base({scales:{x:XA,y:Y(P,{min:0,max:250})}})});
mk('c_ttmfcf',{type:'line',data:{labels:C.ttmfcf.labels,datasets:[{label:'TTM free cash flow',data:C.ttmfcf.fcf,borderColor:navy,backgroundColor:'rgba(61,79,111,.12)',fill:true,borderWidth:2.5,pointRadius:2}]},
 options:base({scales:{x:Xyear,y:Y(B)}})});
mk('c_wc',{type:'bar',data:{labels:C.wc.labels,datasets:[
 {label:'Change in deferred merchant bookings & other liabilities',data:C.wc.wc,backgroundColor:navy},
 {label:'Stock-based comp',data:C.wc.sbc,backgroundColor:sand},{label:'Cash taxes paid',data:C.wc.tax,backgroundColor:rust}]},
 options:base({scales:{x:XA,y:Y(B)}})});
mk('c_fcfps',{type:'bar',data:{labels:C.fcfps.labels,datasets:[{label:'FCF per diluted share',data:C.fcfps.v,backgroundColor:C.fcfps.v.map((v,i)=>i==C.fcfps.v.length-1?rust:navy)}]},
 options:base({plugins:{legend:Object.assign({},leg,{display:true})},scales:{x:XA,y:Y(v=>'$'+v)}})});
mk('c_mkt',{type:'line',data:{labels:C.mkt.labels,datasets:[
 {label:'Marketing % of revenue',data:C.mkt.rev,borderColor:navy,backgroundColor:navy,borderWidth:2.5,pointRadius:3}]},
 options:base({scales:{x:XA,y:Y(P,{min:25,max:40})}})});
mk('c_mktgbv',{type:'line',data:{labels:C.mkt.labels,datasets:[
 {label:'Marketing % of gross bookings',data:C.mkt.gbv,borderColor:rust,backgroundColor:rust,borderWidth:2.5,pointRadius:3}]},
 options:base({scales:{x:XA,y:Y(P,{min:3,max:7})}})});
mk('c_mrn',{type:'bar',data:{labels:C.mrn.labels,datasets:[{label:'Marketing per room night',data:C.mrn.v,backgroundColor:C.mrn.v.map((v,i)=>i==C.mrn.v.length-1?rust:navy)}]},
 options:base({scales:{x:XA,y:Y(v=>'$'+v,{min:0})}}),
 plugins:[{id:'lab',afterDatasetsDraw(c){const g=c.ctx,m=c.getDatasetMeta(0);g.save();g.font="600 12px "+SS;g.fillStyle='rgba(27,26,23,.7)';g.textAlign='center';m.data.forEach((b,i)=>g.fillText('$'+C.mrn.v[i].toFixed(2),b.x,b.y-5));g.restore();}}]});
mk('c_qmkt',{type:'bar',data:{labels:C.qmkt.labels,datasets:[{label:'Marketing % of gross bookings',data:C.qmkt.v,backgroundColor:C.qmkt.labels.map(l=>l.endsWith('Q3')?rust:navyL)}]},
 options:base({scales:{x:X,y:Y(P,{min:0,max:10})}})});
mk('c_capex',{type:'bar',data:{labels:C.capex.labels,datasets:[
 {label:'Capex',data:C.capex.capex,backgroundColor:navy},
 {label:'IT expense',data:C.capex.it,backgroundColor:sand}]},
 options:base({scales:{x:XA,y:Y(v=>'$'+v+'M')}})});
mk('c_capexpct',{type:'line',data:{labels:C.capex.labels,datasets:[
 {label:'Capex % of revenue',data:C.capex.capexp,borderColor:rust,backgroundColor:rust,borderWidth:2.5,pointRadius:3},
 {label:'IT % of revenue',data:C.capex.itp,borderColor:ink,backgroundColor:ink,borderWidth:2,borderDash:[5,4],pointRadius:3}]},
 options:base({scales:{x:XA,y:Y(P,{min:0,max:5})}})});
mk('c_vayo',{type:'bar',data:{labels:C.vayo.labels,datasets:[{label:'$100M as % of base',data:C.vayo.v,backgroundColor:C.vayo.v.map(v=>v>5?rust:navy)}]},
 options:base({plugins:{legend:leg},scales:{x:Object.assign({},X,{ticks:{autoSkip:false,maxRotation:0,font:{weight:'600',size:12},callback:function(v){return this.getLabelForValue(v).split(' ')}}}),y:Y(P,{min:0,max:35})}}),
 plugins:[{id:'lab',afterDatasetsDraw(c){const g=c.ctx,m=c.getDatasetMeta(0);g.save();g.font="700 13px "+SS;g.fillStyle='rgba(27,26,23,.8)';g.textAlign='center';m.data.forEach((b,i)=>g.fillText(C.vayo.v[i].toFixed(1)+'%',b.x,b.y-6));g.restore();}}]});
mk('c_cycle',{type:'bar',data:{labels:C.cycle.labels,datasets:[{label:'2019',data:C.cycle.y19,backgroundColor:navy},{label:'2020',data:C.cycle.y20,backgroundColor:rust}]},
 options:base({scales:{x:Object.assign({},X,{ticks:{autoSkip:false,maxRotation:0,font:{weight:'600',size:12},callback:function(v){const l=this.getLabelForValue(v);return l.length>12?l.split(' '):l}}}),y:Y(B)}})});
mk('c_int',{type:'bar',data:{labels:C.int.labels,datasets:[{label:'Interest income',data:C.int.inc,backgroundColor:olive},{label:'Interest expense',data:C.int.exp,backgroundColor:rust}]},
 options:base({scales:{x:XA,y:Y(B)}})});
mk('c_etr',{type:'bar',data:{labels:C.etr.labels,datasets:[{label:'Effective tax rate',data:C.etr.v.map(v=>Math.min(v,50)),backgroundColor:C.etr.v.map((v,i)=>i==C.etr.v.length-1?rust:navy)}]},
 options:base({scales:{x:XA,y:Y(P,{min:0,max:50})}}),
 plugins:[{id:'lab',afterDatasetsDraw(c){const g=c.ctx,m=c.getDatasetMeta(0);g.save();g.font="600 12px "+SS;g.fillStyle='rgba(27,26,23,.75)';g.textAlign='center';m.data.forEach((b,i)=>g.fillText(C.etr.v[i]+'%',b.x,b.y-5));g.restore();}}]});
});
