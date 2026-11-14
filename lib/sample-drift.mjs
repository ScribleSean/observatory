// Fictional model drift rows for the preview, the demo and tests. No transcript is read.
// The story: one model thinks and writes less for the last three days with the same effort (worth a
// look), one has a day of retries, one longer-thinking day is explained by a switch to max effort, and a
// third model is too quiet to judge.
import {binOf,EFFORTS} from './drift.mjs';

const MODELS=[
  {model:'claude-opus-5-5',replies:420,thinking:4,replySeconds:9,outputTokens:650,efforts:{high:0.8,medium:0.2}},
  {model:'claude-sonnet-4-20250514',replies:260,thinking:1.6,replySeconds:5,outputTokens:420,efforts:{medium:0.7,low:0.3}},
  {model:'claude-haiku-4-5',replies:12,thinking:0.6,replySeconds:2,outputTokens:180,efforts:{low:1}},
];

function random(seed) {
  let state=seed;
  return ()=>{state=(state*16807)%2147483647;return state/2147483647;};
}

// A log-normal draw around `median`, spread like real reply times.
const draw=(next,median,spread=0.55)=>{
  const u=Math.max(1e-9,next()),v=next();
  return median*Math.exp(spread*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v));
};

function histogram(values) {
  const map=new Map();
  for(const value of values) {const bin=binOf(value);map.set(bin,(map.get(bin) ?? 0)+1);}
  return [...map.entries()].sort((a,b)=>a[0]-b[0]).flat();
}

export function sampleDriftRow(host,{dates,checkedAt,scale=1,seed=7}) {
  const next=random(seed);
  const days=dates.map((date,index)=>{
    const age=dates.length-1-index;
    const weekend=[0,6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
    const models=MODELS.map(base=>{
      let {thinking,outputTokens,efforts}=base,retryRate=0.004;
      if(base.model==='claude-opus-5-5' && age<=2) {thinking*=0.5;outputTokens*=0.55;}
      if(base.model==='claude-opus-5-5' && age===16) {thinking*=2.2;efforts={max:0.9,high:0.1};}
      if(base.model==='claude-sonnet-4-20250514' && age===9)retryRate=0.14;
      const replies=Math.max(1,Math.round(base.replies*scale*(weekend?0.4:1)*(0.8+0.4*next())));
      const sample=median=>Array.from({length:replies},()=>draw(next,median));
      // zero-ok: an effort level this fictional model never uses.
      const counts=Object.fromEntries([...EFFORTS,'other','unset'].map(name=>[name,Math.round(replies*(efforts[name] ?? 0))]));
      return {model:base.model,replies,retries:Math.round(replies*retryRate*(0.5+next())),
        thinking:histogram(sample(thinking).slice(0,Math.round(replies*0.7))),replySeconds:histogram(sample(base.replySeconds)),
        outputTokens:histogram(sample(outputTokens)),efforts:counts};
    });
    return {date,models};
  });
  return {host,status:'ok',checkedAt,days};
}
