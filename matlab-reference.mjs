import {readdir, readFile, realpath, stat} from 'node:fs/promises';
import {resolve, dirname, relative, isAbsolute, join} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {existsSync} from 'node:fs';

export const name='matlab-reference';
export const inject=['tools'];
const PAGE_BYTES=6000;
const MAX_FILE_BYTES=512*1024;
/**
 * Locate the running DeepSeek Harness package so its bundled js-yaml can be
 * loaded. `DSH_PACKAGE_JSON` overrides; otherwise derive it from the launcher
 * path (`dsh` -> `<dsh>/lib/bin.js` -> `<dsh>/package.json`).
 */
function dshPackageJson() {
  const candidates = [process.env.DSH_PACKAGE_JSON];
  if (process.argv[1]) candidates.push(resolve(dirname(process.argv[1]), '..', 'package.json'));
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate) && candidate.endsWith('package.json')) return candidate;
  }
  throw new Error('matlab-reference: set DSH_PACKAGE_JSON to the DeepSeek Harness package.json');
}
const require=createRequire(dshPackageJson());
const {load:loadYaml}=require('js-yaml');
const ALIASES={ecg:'signal filter peak',eeg:'signal filter spectrum wavelet',emg:'signal filter features',
  denoise:'filter noise',denoising:'filter noise',psd:'signal spectrum spectral',fft:'signal spectrum spectral',
  resampling:'signal resample filter',segmentation:'image mask',registration:'image registration',
  dicom:'medical image data',nifti:'medical image volume data',voxel:'medical volume image',
  spectrogram:'signal time frequency',cwt:'wavelet signal',debug:'debugging error'};
const STOP=new Set('a an the and or for to in on of with use using matlab skill skills how i my'.split(' '));
const ORIGIN='official-toolkit';

function terms(text, expand=false) {
  const words=text.toLowerCase().match(/[a-z0-9]+/g)??[];
  if(expand) for(const word of [...words]) if(ALIASES[word]) words.push(...ALIASES[word].split(' '));
  return words.filter(word=>word.length>1&&!STOP.has(word));
}
function header(text) {
  const match=text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if(!match) return null;
  let meta;try {meta=loadYaml(match[1]);} catch {return null;}
  const {name,description,license}=meta??{};
  if(typeof name!=='string'||typeof description!=='string'||!description.trim()||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) return null;
  return {name,description:description.trim(),license:license??'See upstream LICENSE',body:text.slice(match[0].length)};
}
function sections(text) {
  let fence=false;
  const found=[];
  let offset=0;
  for(const line of text.split(/(?<=\n)/)) {
    if(/^\s*(```|~~~)/.test(line)) fence=!fence;
    if(!fence) {
      const m=line.match(/^(#{1,6})\s+(.+?)\s*\n?$/);
      if(m) found.push({title:m[2],level:m[1].length,offset});
    }
    offset+=line.length;
  }
  return found;
}
function within(root,path) {
  const rel=relative(root,path);
  return rel===''||(!rel.startsWith('..'+String.fromCharCode(47))&&rel!=='..'&&!isAbsolute(rel));
}
function page(text,offset) {
  if(!Number.isInteger(offset)||offset<0||offset>text.length) throw new Error('offset must be a valid character offset from the previous result.');
  let chunk=Buffer.from(text.slice(offset)).subarray(0,PAGE_BYTES).toString('utf8');
  if(chunk.endsWith('\uFFFD')) chunk=chunk.slice(0,-1);
  if(offset+chunk.length<text.length) {
    const newline=chunk.lastIndexOf('\n');
    if(newline>chunk.length/2) chunk=chunk.slice(0,newline+1);
  }
  return {text:chunk,next_offset:offset+chunk.length<text.length?offset+chunk.length:null};
}
function resolveRoot(config) {
  const root=config?.catalogRoot;
  if(typeof root!=='string'||!root.trim()) throw new Error('Configure catalogRoot with the official MATLAB Agentic Toolkit catalogue path.');
  return resolve(root);
}

export class SkillIndex {
  constructor(root) {
    if(typeof root!=='string'||!root.trim()) throw new Error('An official MATLAB Agentic Toolkit catalogue root is required.');
    this.root=resolve(root);
    this.entries=[];
  }
  async refresh() {
    const entries=[],root=await realpath(this.root);
    const walk=async(dir,depth=0)=>{
      if(depth>5) return;
      for(const item of await readdir(dir,{withFileTypes:true})) {
        if(item.name.startsWith('.')) continue;
        const path=join(dir,item.name);
        if(item.isDirectory()) await walk(path,depth+1);
        else if(item.isFile()&&item.name==='SKILL.md') {
          if((await stat(path)).size>MAX_FILE_BYTES) continue;
          const text=await readFile(path,'utf8'), meta=header(text);
          if(!meta) continue;
          const headings=sections(meta.body), tokenList=terms(meta.name+' '+meta.description+' '+headings.map(s=>s.title).join(' ')+' '+meta.body);
          const tf=new Map();for(const t of tokenList) tf.set(t,(tf.get(t)??0)+1);
          entries.push({...meta,path,origin:ORIGIN,headings,tf,length:tokenList.length,
            titleTerms:new Set(terms(meta.name+' '+meta.description))});
        }
      }
    };
    await walk(root);
    entries.sort((a,b)=>a.name.localeCompare(b.name));
    const names=new Set();for(const e of entries) {if(names.has(e.name)) throw new Error('Duplicate skill name in official catalogue: '+e.name);names.add(e.name);}
    if(!entries.length) throw new Error('No valid references found in configured roots.');
    this.entries=entries;
    this.averageLength=entries.reduce((n,e)=>n+e.length,0)/entries.length;
    this.df=new Map();for(const e of entries) for(const term of e.tf.keys()) this.df.set(term,(this.df.get(term)??0)+1);
  }
  search(query,limit=2) {
    if(typeof query!=='string'||!query.trim()||query.length>500) throw new Error('Provide a focused query of 1–500 characters.');
    if(!Number.isInteger(limit)||limit<1||limit>4) throw new Error('limit must be 1–4.');
    const q=[...new Set(terms(query,true))], count=this.entries.length;
    const ranked=this.entries.map(e=>{
      let score=0;
      for(const t of q) {
        const f=e.tf.get(t)??0, df=this.df.get(t)??0;
        if(f) score+=Math.log(1+(count-df+0.5)/(df+0.5))*f*2.2/(f+1.2*(0.25+0.75*e.length/this.averageLength));
        if(e.titleTerms.has(t)) score+=2;
      }
      const matching=e.headings.map(h=>({title:h.title,score:terms(h.title).filter(t=>q.includes(t)).length})).filter(h=>h.score).sort((a,b)=>b.score-a.score).slice(0,3).map(h=>h.title);
      return {name:e.name,origin:e.origin,description:e.description.slice(0,240),sections:matching,score:Math.round(score*100)/100};
    }).filter(e=>e.score>0).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name)).slice(0,limit);
    const totalByOrigin={[ORIGIN]:this.entries.length};
    return {results:ranked,total_skills:count,total_by_origin:totalByOrigin,hint:ranked.length?'Read one relevant section, then use MATLAB to test the next step.':'No match. Try a toolbox, MATLAB function or workflow name.'};
  }
  async read(name,{section,resource,offset=0}={}) {
    const e=this.entries.find(x=>x.name===name);
    if(!e) throw new Error('Unknown reference. Search for the exact name first.');
    const base=await realpath(dirname(e.path));
    const path=await realpath(resource?resolve(base,resource):e.path);
    if(!within(base,path)) throw new Error('Resource must stay inside this reference directory.');
    if((await stat(path)).size>MAX_FILE_BYTES) throw new Error('Resource is too large; use a targeted file read.');
    const text=await readFile(path,'utf8');
    if(text.includes('\0')) throw new Error('Only text resources can be read.');
    let body=resource?text:(header(text)?.body??text);
    const headings=sections(body);
    if(section) {
      const matches=headings.filter(h=>h.title.toLowerCase()===section.toLowerCase());
      if(matches.length!==1) throw new Error('Section missing or ambiguous. Available: '+headings.map(h=>h.title).join('; ').slice(0,1200));
      const selected=matches[0], end=headings.find(h=>h.offset>selected.offset&&h.level<=selected.level)?.offset??body.length;
      body=body.slice(selected.offset,end);
    }
    const part=page(body,offset);
    const result={name,origin:e.origin,source:path,license:e.license,resource_base:base,section:section??null,offset,...part,
      ...(offset===0&&!section?{sections:headings.slice(0,12).map(h=>h.title.slice(0,100))}:{}),
      continuation:part.next_offset===null?null:'Call with the same name, section and resource, and next_offset as offset. Code fences may span pages.'};
    while(Buffer.byteLength(JSON.stringify(result,null,2))>8192) {
      if(result.text.length<256) throw new Error('Reference metadata is too large to return within the page budget.');
      result.text=result.text.slice(0,-256).replace(/[\uD800-\uDBFF]$/,'');
      result.next_offset=offset+result.text.length;
      result.continuation='Continue with next_offset as offset and the same name, section and resource.';
    }
    return result;
  }
}

export async function apply(ctx,config) {
  const {defineTool}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-tools')).href);
  const index=new SkillIndex(resolveRoot(config));await index.refresh();
  const output={schema:{type:'string'},render:(_args,text)=>[{type:'text',text}]};
  ctx.tools.register(defineTool({name:'search_matlab_skills',
    description:'Search official MATLAB Agentic Toolkit skills. Returns short ranked results; default two.',
    parameters:{query:{type:'string',required:true},limit:{type:'integer',description:'1–4 results; default 2.'}},output,
    async execute(args){return JSON.stringify(index.search(args.query,args.limit),null,2);}}));
  ctx.tools.register(defineTool({name:'read_matlab_skill',
    description:'Read one official Toolkit skill section or bounded page. Follow next_offset for continuation.',
    parameters:{name:{type:'string',required:true},section:{type:'string'},resource:{type:'string'},offset:{type:'integer',description:'Nonnegative character offset from next_offset.'}},output,
    async execute(args){return JSON.stringify(await index.read(args.name,args),null,2);}}));
}
