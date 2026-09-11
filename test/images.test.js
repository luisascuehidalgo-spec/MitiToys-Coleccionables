const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
let query;
require('../lib/db').getDb = () => query;
const imageHandler = require('../api/admin-image');
const productHandler = require('../api/admin-product');
const announcementHandler = require('../api/anuncio');
const { uploadImage } = require('../lib/cloudinary');
const png = Buffer.from('89504e470d0a1a0a0000000d49484452','hex');
const url = 'https://res.cloudinary.com/test-cloud/image/upload/v1/mititoys/products/test.png';

function setup(t) {
  for (const [key,value] of Object.entries({ADMIN_SESSION_SECRET:'test-only-secret',CLOUDINARY_CLOUD_NAME:'test-cloud',CLOUDINARY_API_KEY:'test-key',CLOUDINARY_API_SECRET:'test-secret'})) {
    const previous=process.env[key];process.env[key]=value;
    t.after(()=>{if(previous===undefined)delete process.env[key];else process.env[key]=previous});
  }
  const previous=global.fetch;
  global.fetch=async()=>({ok:true,json:async()=>({resource_type:'image',format:'png',secure_url:url})});
  t.after(()=>{global.fetch=previous});
}
async function call(handler,method,{body,bytes=png,authorized=true,query:params={productId:'test'},mime='image/png'}={}) {
  const value='admin:'+Date.now();
  const signature=createHmac('sha256',process.env.ADMIN_SESSION_SECRET||'').update(value).digest('hex');
  const req=Readable.from([bytes]);
  const search=new URLSearchParams(params||{}).toString();
  Object.assign(req,{method,body,url:'/api/admin-image'+(search?'?'+search:''),headers:{'content-type':mime,cookie:authorized?'mititoys_admin='+Buffer.from(value+'.'+signature).toString('base64url'):''}});
  const res={code:200,headers:{},status(code){this.code=code;return this},json(value){this.body=value;return this},setHeader(k,v){this.headers[k]=v}};
  await handler(req,res);return res;
}
function imageDb({count=0,legacy=0,exists=true,append=true}={}) {
  const calls=[];
  query=async(strings,...values)=>{
    const sql=strings.join('?');calls.push({sql,values});
    if(sql.startsWith('SELECT id FROM products'))return exists?[{id:'test'}]:[];
    if(sql.includes('uploaded_count'))return [{uploaded_count:count}];
    if(sql.includes('AS count FROM products'))return [{count:legacy}];
    if(sql.includes('UPDATE products'))return append?[{id:'test'}]:[];
    throw Error('Unexpected SQL: '+sql);
  };
  return calls;
}
test('new upload stores only the Cloudinary URL and never writes binary table',async t=>{
  setup(t);const calls=imageDb({legacy:1,count:2});
  const res=await call(imageHandler,'POST');
  assert.equal(res.code,201);assert.equal(res.body.image.url,url);
  assert.ok(calls.some(c=>c.sql.includes('COALESCE(images')&&c.values.includes(JSON.stringify([url]))));
  assert.ok(calls.every(c=>!c.sql.includes('image_data')&&!c.values.some(Buffer.isBuffer)));
  assert.equal(imageHandler.config.api.bodyParser,false);
});
test('unauthenticated request cannot contact database or Cloudinary',async t=>{
  setup(t);query=()=>assert.fail('database called');global.fetch=()=>assert.fail('provider called');
  assert.equal((await call(imageHandler,'POST',{authorized:false})).code,401);
});
test('missing configuration fails without storing photos',async t=>{
  setup(t);delete process.env.CLOUDINARY_API_SECRET;const calls=imageDb();
  assert.equal((await call(imageHandler,'POST')).code,503);assert.equal(calls.length,0);
});
test('validates count, missing product, mime, empty bytes and size',async t=>{
  setup(t);global.fetch=()=>assert.fail('provider called');
  imageDb({legacy:8});assert.equal((await call(imageHandler,'POST')).code,400);
  imageDb({exists:false});assert.equal((await call(imageHandler,'POST')).code,404);
  imageDb();assert.equal((await call(imageHandler,'POST',{mime:'image/svg+xml'})).code,400);
  assert.equal((await call(imageHandler,'POST',{bytes:Buffer.alloc(0)})).code,400);
  assert.equal((await call(imageHandler,'POST',{bytes:Buffer.from('not an image')})).code,400);
  assert.equal((await call(imageHandler,'POST',{bytes:Buffer.alloc(4*1024*1024+1)})).code,413);
});
test('provider failure and timeout never save a URL or disclose provider messages',async t=>{
  setup(t);const calls=imageDb();
  global.fetch=async()=>({ok:false,json:async()=>({error:{message:'test-secret'}})});
  let res=await call(imageHandler,'POST');assert.equal(res.code,502);assert.ok(!JSON.stringify(res.body).includes('test-secret'));
  global.fetch=async()=>{throw Error('test-secret')};
  res=await call(imageHandler,'POST');assert.equal(res.code,502);
  assert.ok(!calls.some(c=>c.sql.includes('UPDATE')));
});
test('full product after concurrent upload returns conflict',async t=>{
  setup(t);imageDb({append:false});assert.equal((await call(imageHandler,'POST')).code,409);
});
test('database failure after upload returns actionable error without exposing details',async t=>{
  setup(t);imageDb();const previous=query;
  query=(s,...v)=>s.join('').includes('UPDATE')?Promise.reject(Error('private database detail')):previous(s,...v);
  const res=await call(imageHandler,'POST');assert.equal(res.code,500);assert.ok(!JSON.stringify(res.body).includes('private database'));
});
test('upload signs credentials server-side and refuses unexpected delivery URLs',async t=>{
  setup(t);
  global.fetch=async(endpoint,options)=>{
    assert.equal(endpoint,'https://api.cloudinary.com/v1_1/test-cloud/image/upload');
    assert.equal(options.body.get('api_secret'),null);
    assert.match(options.body.get('signature'),/^[a-f0-9]{64}$/);
    assert.equal(options.body.get('overwrite'),'false');
    return {ok:true,json:async()=>({resource_type:'image',format:'png',secure_url:'https://untrusted.example/image.png'})};
  };
  await assert.rejects(uploadImage(png,'image/png'),e=>e.status===502);
});
test('create and edit preserve supplied URLs; stale edits are rejected',async t=>{
  setup(t);const body={id:'test',title:'Test',price:100,stock_quantity:0,images:[url],original_images:[url],updated_at:'2026-09-07T18:00:00.123Z'};
  const calls=[];
  query=async(s,...v)=>{const sql=s.join('?');calls.push({sql,v});return sql.startsWith('SELECT')?[]:[{...body}]};
  assert.equal((await call(productHandler,'POST',{body})).code,201);
  assert.ok(calls.some(c=>c.v.includes(JSON.stringify([url]))));
  let conflict=false;
  query=async(s,...v)=>{
    const sql=s.join('?');calls.push({sql,v});
    if(sql.includes('SELECT stock_quantity'))return [{stock_quantity:0,images:[url],updated_at:body.updated_at}];
    if(sql.includes('COUNT(*)'))return [{count:1}];
    if(sql.includes('UPDATE products SET'))return conflict?[]:[body];
    throw Error(sql);
  };
  assert.equal((await call(productHandler,'PUT',{body})).code,200);
  assert.ok(calls.some(c=>c.sql.includes("COALESCE(images,'[]'::jsonb)=")));
  conflict=true;assert.equal((await call(productHandler,'PUT',{body})).code,409);
});
function adminContext(fetch) {
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',files:[],checked:false,disabled:false,textContent:'',classList:{add(){},remove(){}},addEventListener(){}});return nodes.get(id)};
  const context=vm.createContext({document:{getElementById:get},fetch,URL,Intl,console,location:{},alert(){}});
  vm.runInContext(fs.readFileSync(require.resolve('../admin.html'),'utf8').match(/<script>([\s\S]*)<\/script>/)[1],context);
  vm.runInContext('loadData=async()=>{}',context);
  return {context,get};
}
test('admin rejects nine files before creating product',async()=>{
  const {context,get}=adminContext(()=>assert.fail('network called'));
  get('newFiles').files=Array(9).fill({size:1,type:'image/png'});
  await vm.runInContext('createProduct()',context);
  assert.match(get('createStatus').textContent,/8 fotos/);
});
test('admin create uploads eight files and reports partial failure with recovery instructions',async()=>{
  let uploads=0,fail=false;
  const {context,get}=adminContext(async(path,options)=>{
    if(path.includes('productId')){uploads++;return {ok:!fail,json:async()=>fail?{error:'Fallo de prueba'}:{image:{url}}}}
    return {ok:true,json:async()=>({})};
  });
  const fill=()=>{get('newId').value='test';get('newTitle').value='Test';get('newPrice').value='100';get('newStock').value='0';get('newFiles').files=Array(8).fill({size:100,type:'image/png',name:'test.png'})};
  fill();await vm.runInContext('createProduct()',context);assert.equal(uploads,8);assert.match(get('createStatus').textContent,/correctamente/);
  fill();fail=true;await vm.runInContext('createProduct()',context);assert.match(get('createStatus').textContent,/ya está creado/);assert.match(get('createStatus').textContent,/solo las faltantes/);
});
test('admin edit sends old URL snapshot and uploads selected image',async()=>{
  let edited=false,uploaded=false;
  const version='2026-09-07T18:00:00.123Z';
  const {context,get}=adminContext(async(path,options)=>{
    if(options?.method==='PUT'){edited=true;const payload=JSON.parse(options.body);assert.deepEqual(payload.original_images,[url]);assert.equal(payload.updated_at,version)}
    if(path.includes('productId'))uploaded=true;
    return {ok:true,json:async()=>({image:{url}})};
  });
  vm.runInContext('data.products='+JSON.stringify([{id:'test',images:[url],uploaded_images:[{id:1}],updated_at:version}]),context);
  for(const [id,value]of Object.entries({'title-test':'Test','price-test':'100','stock-test':'0','legacy-test':url}))get(id).value=value;
  get('files-test').files=[{size:100,type:'image/png',name:'test.png'}];
  await vm.runInContext("saveProduct('test')",context);
  assert.ok(edited&&uploaded);assert.equal(get('ps-test').textContent,'Guardado');
});

test('promotional gallery renders only current Cloudinary product images',async()=>{
  query=async s=>{
    const sql=s.join('');
    assert.ok(!sql.includes('product_images'));
    return [{id:'new',title:'New',images:[url,'https://legacy.example/a.jpg']}];
  };
  const res={status(code){this.code=code;return this},setHeader(){},send(body){this.body=body;return this}};
  await announcementHandler({method:'GET'},res);
  assert.equal(res.code,200);assert.ok(res.body.includes(url));
  assert.ok(!res.body.includes('/api/product-image'));
  assert.ok(!res.body.includes('legacy.example'));
});