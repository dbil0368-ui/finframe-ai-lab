const ALLOWED = new Set(["IN","US","GB","CA","AU","BD","DE","FR","JP","SG"]);
function decodeXml(value="") {
 return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,"$1").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"\'");
}
function tag(xml,name) { const m=xml.match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</"+name+">","i")); return m?decodeXml(m[1].trim()):""; }
module.exports = async function handler(req,res) {
 res.setHeader("Cache-Control","s-maxage=900, stale-while-revalidate=1800");
 res.setHeader("Access-Control-Allow-Origin","*");
 if(req.method==="OPTIONS"){res.status(204).end();return;}
 const geo=String(req.query.geo||"IN").toUpperCase();
 if(!ALLOWED.has(geo)){res.status(400).json({error:"Unsupported region"});return;}
 try {
  const response=await fetch("https://trends.google.com/trending/rss?geo="+geo,{headers:{"User-Agent":"VYBORA-TrendRadar/1.0","Accept":"application/rss+xml, application/xml, text/xml"},signal:AbortSignal.timeout(12000)});
  if(!response.ok) throw new Error("Google Trends returned HTTP "+response.status);
  const xml=await response.text();
  const channel=(xml.match(/<channel[\\s\\S]*?<\\/channel>/i)||[])[0]||xml;
  const items=[...channel.matchAll(/<item(?:\\s[^>]*)?>([\\s\\S]*?)<\\/item>/gi)].map((m,i)=>({rank:i+1,title:tag(m[1],"title"),traffic:tag(m[1],"ht:approx_traffic"),published:tag(m[1],"pubDate"),source:"Google Trends RSS"})).filter(x=>x.title);
  res.status(200).json({region:geo,source:"Google Trends public RSS",sourceUrl:"https://trends.google.com/trending?geo="+geo,updatedAt:new Date().toISOString(),limited:true,items});
 } catch(error) { res.status(502).json({error:"Trend feed is temporarily unavailable",detail:String(error.message||error)}); }
}