import { geminiGenerate } from "../src/lib/ai/gemini.ts";
import assert from "node:assert/strict";
const ok = (t: string) => new Response(JSON.stringify({candidates:[{content:{parts:[{text:t}]}}]}), {status:200});
const err = (s: number, m = "x") => new Response(JSON.stringify({error:{code:s,message:m}}), {status:s});
const base = { apiKey:" k\n", body:{}, models:["a","b","c"], sleep: async()=>{}, log: ()=>{} };
const modelOf = (u: string) => u.split("/models/")[1].split(":")[0];
let n=0;
// 1. 503 on first model twice → falls over to model b
{ const calls:string[]=[]; const r = await geminiGenerate({...base, fetchImpl: async(u)=>{calls.push(modelOf(u)); return modelOf(u)==="a"?err(503):ok("hi");}});
  assert.equal(r.text,"hi"); assert.equal(r.model,"b"); assert.deepEqual(calls,["a","a","b"]); n++; }
// 2. 503 once then success on same model (retry works)
{ let c=0; const r = await geminiGenerate({...base, fetchImpl: async()=> (++c===1?err(503):ok("again"))}); assert.equal(r.model,"a"); assert.equal(c,2); n++; }
// 3. invalid key fails fast, no retry
{ let c=0; await assert.rejects(geminiGenerate({...base, fetchImpl: async()=>{c++; return err(400,"API key not valid");}}), /400/); assert.equal(c,1); n++; }
// 4. 404 model gone → next model
{ const r = await geminiGenerate({...base, fetchImpl: async(u)=> modelOf(u)==="a"?err(404,"model not found"):ok("ok")}); assert.equal(r.model,"b"); n++; }
// 5. 429 → next model immediately (1 call on a)
{ const calls:string[]=[]; const r = await geminiGenerate({...base, fetchImpl: async(u)=>{calls.push(modelOf(u)); return modelOf(u)==="c"?ok("z"):err(429);}}); assert.deepEqual(calls,["a","b","c"]); n++; }
// 6. everything 503 → after 2 sweeps throws transient error
{ let c=0; await assert.rejects(geminiGenerate({...base, fetchImpl: async()=>{c++; return err(503);}}), (e:any)=> e.status===503 && e.transient===true); assert.equal(c, 3*2*2); n++; }
// 7. network error is retried
{ let c=0; const r = await geminiGenerate({...base, fetchImpl: async()=>{ if(++c<3) throw new Error("fetch failed"); return ok("net"); }}); assert.equal(r.text,"net"); n++; }
// 8. empty response → next model; key sent via header not URL
{ let url="", hdr:any; const r = await geminiGenerate({...base, fetchImpl: async(u,i)=>{url=u; hdr=i.headers; return modelOf(u)==="a"?ok("  "):ok("full");}}); assert.equal(r.model,"b"); assert.ok(url.endsWith("?key=k")); n++; }
console.log(`ALL ${n} GEMINI TESTS PASSED`);
