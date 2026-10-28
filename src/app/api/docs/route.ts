const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>IVACP API 文档</title><link rel="stylesheet" href="/api/docs/assets/swagger-ui.css">
<style>body{margin:0;background:#f7faf9;color:#16352a;font-family:system-ui,sans-serif}header{padding:20px max(20px,calc((100% - 1460px)/2));border-bottom:1px solid #d6e4dc;background:white}h1{font-size:20px;margin:0 0 8px}p{margin:0;font-size:13px;line-height:1.6}a{color:#16823f}.swagger-ui .topbar{display:none}#loading{padding:20px;max-width:1460px;margin:auto}</style>
</head><body><header><h1>IVACP API 文档</h1><p>接口调用沿用当前登录会话。<a href="/login" target="_blank" rel="noreferrer">登录</a> · <a href="/api/openapi" target="_blank" rel="noreferrer">OpenAPI JSON</a> · <a href="/">返回平台</a></p></header>
<div id="loading" role="status">正在加载本地接口文档…</div><div id="swagger-ui"></div>
<script src="/api/docs/assets/swagger-ui-bundle.js"></script><script>
if (typeof SwaggerUIBundle === 'undefined') { document.getElementById('loading').textContent = '文档资源加载失败，请刷新或查看 OpenAPI JSON。'; }
else { window.ui = SwaggerUIBundle({ url:'/api/openapi', dom_id:'#swagger-ui', deepLinking:true, displayRequestDuration:true, defaultModelsExpandDepth:0, persistAuthorization:false, validatorUrl:null, onComplete:function(){document.getElementById('loading').hidden=true;} }); }
</script></body></html>`;

export function GET() {
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" } });
}
