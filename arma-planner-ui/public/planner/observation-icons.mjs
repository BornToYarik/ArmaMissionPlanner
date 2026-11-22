// Small native SVG symbols: generated locally, no game assets or image requests.
const binoculars='<path d="M23 18h18v8H23z" fill="#14212a"/><circle cx="25" cy="23" r="4" fill="#b5d8e3"/><circle cx="39" cy="23" r="4" fill="#b5d8e3"/>';
const observer='<path d="M23 16a9 9 0 0 1 18 0v8H23z" fill="currentColor"/><path d="M21 16h22M24 15v-3a8 8 0 0 1 16 0v3"/><path d="m22 27-7 7 6 6 6-10m15-3 7 7-6 6-6-10" fill="currentColor"/>'+binoculars;
export function observationIcon(eye){return '<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false" fill="none" stroke="#10202a" stroke-width="2.5" stroke-linejoin="round">'+(eye===2.3?
 '<rect x="5" y="46" width="54" height="13" rx="6" fill="#25394a"/><path d="M8 43h48l4 10H4zM19 34h24l5 10H15z" fill="currentColor"/><path d="M43 37h19v5H43z" fill="currentColor"/><ellipse cx="30" cy="35" rx="9" ry="3" fill="#10202a"/>'+observer+'<path d="M25 28h14v8H25z" fill="currentColor"/><path d="M12 53h40" stroke="#95acb9"/>':
 '<path d="M23 28h18l2 17H21z" fill="currentColor"/><path d="m24 43-4 17h9l4-17m5 0 6 17h-9l-5-17" fill="currentColor"/>'+observer)+ '</svg>';}
