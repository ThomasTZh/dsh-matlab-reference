import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, writeFile, symlink, rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {homedir} from 'node:os';
import {tmpdir} from 'node:os';
import {delimiter, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {SkillIndex,apply} from './matlab-reference.mjs';

test('search ranks domain references and reads bounded, complete pages and resources',async()=>{
  const root=await mkdtemp(join(tmpdir(),'matlab-reference-'));
  try {
    for(const [name,description,body] of [
      ['matlab-filter','Digital signal filtering for ECG EEG','## Design\nUse Hz and sample rate.\n## Examples\n'+('value = "λ";\n'.repeat(1800))],
      ['matlab-medical','Read DICOM NIfTI medical image volumes','## Geometry\nKeep voxel spacing.\n[Details](references/detail.md)'],
      ['matlab-antenna','Design RF antenna arrays','## Radiation\nFar field electromagnetic pattern.']]) {
      const dir=join(root,'domain',name);await mkdir(dir,{recursive:true});
      await writeFile(join(dir,'SKILL.md'),`---\nname: ${name}\ndescription: ${description}\nlicense: BSD-3-Clause\n---\n${body}`);
    }
    const index=new SkillIndex(root);await index.refresh();
    assert.equal(index.search('ECG denoising').results[0].name,'matlab-filter');
    assert.equal(index.search('DICOM voxel orientation').results[0].name,'matlab-medical');
    assert.equal(index.search('zxqvunknown').results.length,0);
    assert.throws(()=>index.search('filter',5),/1–4/);
    assert.throws(()=>index.search(''),/focused/);
    await assert.rejects(index.read('../../etc/passwd'),/Unknown/);
    const first=await index.read('matlab-filter',{section:'Design'});
    assert.match(first.text,/sample rate/);assert.doesNotMatch(first.text,/Examples/);
    let offset=0,whole='';
    do {
      const part=await index.read('matlab-filter',{section:'Examples',offset});
      assert.ok(Buffer.byteLength(part.text)<=6000);
      assert.ok(Buffer.byteLength(JSON.stringify(part))<8192);
      assert.ok(!part.text.includes('\uFFFD'));
      whole+=part.text;offset=part.next_offset;
    } while(offset!==null);
    assert.equal(whole,'## Examples\n'+('value = "λ";\n'.repeat(1800)));
    const refs=join(root,'domain','matlab-medical','references');await mkdir(refs);
    await writeFile(join(refs,'detail.md'),'Physical spacing in mm.');
    assert.match((await index.read('matlab-medical',{resource:'references/detail.md'})).text,/spacing/);
    await writeFile(join(refs,'escaped.md'),'\\"\u0001'.repeat(4000));
    const escaped=await index.read('matlab-medical',{resource:'references/escaped.md'});
    assert.ok(Buffer.byteLength(JSON.stringify(escaped,null,2))<=8192);
    assert.ok(escaped.next_offset>0);
    await symlink('/etc/passwd',join(refs,'escape.md'));
    await assert.rejects(index.read('matlab-medical',{resource:'references/escape.md'}),/inside/);
    await assert.rejects(index.read('matlab-filter',{section:'Missing'}),/Section missing/);
    await writeFile(join(root,'domain','matlab-filter','SKILL.md'),'---\nname: matlab-filter\ndescription: Digital filter\n---\nUpdated body.');
    assert.equal((await index.read('matlab-filter')).text,'Updated body.');
    const registered=[];
    await apply({tools:{register:tool=>registered.push(tool)}},{catalogRoot:root});
    assert.deepEqual(registered.map(t=>t.name),['search_matlab_skills','read_matlab_skill']);
  } finally {await rm(root,{recursive:true,force:true});}
});

const TOOLKIT=process.env.MATLAB_TOOLKIT??join(homedir(),'.matlab','agentic-toolkits','matlab','skills-catalog');

test('installed toolkit is searchable without mounting its full catalogue',{skip:existsSync(TOOLKIT)?false:'no toolkit at MATLAB_TOOLKIT'},async()=>{
  const index=new SkillIndex(TOOLKIT);await index.refresh();
  assert.ok(index.entries.length>50);
  for(const [query,expected] of [['digital filter ECG','matlab-design-digital-filter'],['DICOM NIfTI medical data','matlab-read-medical-data'],['continuous wavelet cwt','matlab-analyze-signal-cwt']]) {
    const result=index.search(query,4).results.find(r=>r.name===expected);
    assert.ok(result,query);assert.ok(result.description.length>15);
  }
});

/** First `dsh` executable on PATH, if this machine has one. */
function whichDsh() {
  for(const dir of (process.env.PATH??'').split(delimiter)) {
    if(!dir) continue;
    const candidate=join(dir,'dsh');
    if(existsSync(candidate)) return candidate;
  }
}

/** Run one script in a child node with a controlled environment. */
function runChild(script,work,env) {
  return spawnSync(process.execPath,[script],{cwd:work,encoding:'utf8',env:{...process.env,...env},timeout:30000});
}

/** A tiny catalogue the child can index without the installed toolkit. */
async function fixture(root) {
  await mkdir(join(root,'domain','matlab-filter'),{recursive:true});
  await writeFile(join(root,'domain','matlab-filter','SKILL.md'),'---\nname: matlab-filter\ndescription: Digital filter for ECG\n---\n## Design\nUse Hz.\n');
}

/**
 * Lay out a wrapper launch: a package.json that exists but owns no harness
 * packages, with the running script two levels below it. That is the shape a
 * plugin manager leaves `process.argv[1]` in.
 */
async function wrapperLayout(root) {
  const wrapper=join(root,'node_modules','wrapper');
  await mkdir(join(wrapper,'lib'),{recursive:true});
  await writeFile(join(wrapper,'package.json'),JSON.stringify({name:'wrapper',version:'0.0.0'}));
  return join(wrapper,'lib');
}

const PLUGIN=fileURLToPath(new URL('matlab-reference.mjs',import.meta.url));

test('a wrapper launch finds the harness through the dsh on PATH',{skip:whichDsh()===undefined?'no dsh on PATH':false},async()=>{
  const work=await mkdtemp(join(tmpdir(),'matlab-reference-wrapper-'));
  try {
    const lib=await wrapperLayout(work);
    await fixture(join(work,'catalog'));
    const script=join(lib,'run.mjs');
    await writeFile(script,`const {apply}=await import(process.env.PLUGIN);const tools=[];
await apply({tools:{register:tool=>tools.push(tool)}},{catalogRoot:process.env.CATALOG});
console.log(JSON.stringify(tools.map(tool=>tool.name)));`);
    const env={PLUGIN:PLUGIN,CATALOG:join(work,'catalog'),DSH_PACKAGE_JSON:undefined};
    const result=runChild(script,work,env);
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(result.stdout),['search_matlab_skills','read_matlab_skill']);
  } finally {await rm(work,{recursive:true,force:true});}
});

test('a wrapper package.json without a reachable harness reports the cause instead of crashing at import',async()=>{
  const work=await mkdtemp(join(tmpdir(),'matlab-reference-unresolved-'));
  try {
    const lib=await wrapperLayout(work);
    await fixture(join(work,'catalog'));
    const loader=join(lib,'import.mjs');
    await writeFile(loader,`await import(process.env.PLUGIN);console.log('imported');`);
    const applyScript=join(lib,'apply.mjs');
    await writeFile(applyScript,`const {apply}=await import(process.env.PLUGIN);
await apply({tools:{register(){}}},{catalogRoot:process.env.CATALOG});`);
    const env={PLUGIN:PLUGIN,CATALOG:join(work,'catalog'),DSH_PACKAGE_JSON:undefined,PATH:''};
    const imported=runChild(loader,work,env);
    assert.equal(imported.status,0,imported.stderr);
    assert.match(imported.stdout,/imported/);
    const applied=runChild(applyScript,work,env);
    assert.notEqual(applied.status,0);
    assert.match(applied.stderr,/cannot find the DeepSeek Harness package that owns @deepseek-ai\/dsh-tools/);
  } finally {await rm(work,{recursive:true,force:true});}
});
