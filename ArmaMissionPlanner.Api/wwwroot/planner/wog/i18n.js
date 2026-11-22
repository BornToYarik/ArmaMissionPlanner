import {russian} from './translations.js?v=archive-recordings-1';
export let language='ru';
try{if(localStorage.getItem('ocap-language')==='en')language='en';}catch{}
if(typeof location!=='undefined'){const requested=new URLSearchParams(location.search).get('lang');if(requested==='en'||requested==='ru')language=requested;}
export function t(text,locale=language){return locale==='en'?text:(russian[text]??text);}
export function translatePage(){
 document.documentElement.lang=language;
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
 for(let node;node=walker.nextNode();){
  if(node.parentElement.closest('script,style'))continue;
  const text=node.nodeValue,trimmed=text.trim();
  if(trimmed)node.nodeValue=text.replace(trimmed,t(trimmed));
 }
 for(const el of document.querySelectorAll('[title],[aria-label],[placeholder]'))for(const attr of ['title','aria-label','placeholder']){
  if(el.hasAttribute(attr))el.setAttribute(attr,t(el.getAttribute(attr)));
 }
}
if(typeof document!=='undefined')translatePage();
