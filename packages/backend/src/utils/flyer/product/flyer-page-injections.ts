/**
 * ★ CT-F14 보조 — 전단 페이지 후처리 삽입 모듈 (D154 PHASE 0 분리)
 *
 * renderTemplate(templateCode, data) 진입점에서 6 엔진 HTML 생성 후
 * </body> 직전에 삽입되는 후처리 블록 모음:
 *   - renderQrSection: QR 코드 + 안내 텍스트 (qrCodeDataUrl 있을 때만)
 *   - renderCartScript: Phase 3 장바구니 인라인 JS + CSS (trackingPhone + flyerId 있을 때만)
 *
 * Claude Design 출력 6 엔진(story/magazine/deal_feed/grid_hero/catalog_swipe/poster_promo)은
 * 자체 CTA 버튼을 갖지만, 본 후처리 블록은 추가 인터랙션 layer로 동시 작동.
 * 신규 엔진 카드는 data-product 속성 강제 박음 → cart-script가 자동 셀렉터 매칭.
 */

// ============================================================
// 입력 타입 (FlyerRenderData의 부분집합 — 구조적 타이핑)
// ============================================================

export interface PageInjectionData {
  qrCodeDataUrl?: string;
  qrCouponText?: string;
  trackingPhone?: string;
  flyerId?: string;
}

// ============================================================
// 헬퍼 (모듈 자족 — esc는 8줄 작은 헬퍼라 DRY 위반 1건 허용, 의존성 순환 차단)
// ============================================================

function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ============================================================
// QR 코드 섹션 (V3 보존 — 동작 변경 0)
// ============================================================

export function renderQrSection(d: PageInjectionData): string {
  if (!d.qrCodeDataUrl) return '';
  return `<div style="margin:24px auto 0;padding:20px;text-align:center;border-top:2px dashed #e0e0e0;max-width:340px">
    <img src="${d.qrCodeDataUrl}" alt="QR" style="width:140px;height:140px;margin:0 auto 10px;display:block;border-radius:8px"/>
    <p style="font-size:15px;font-weight:700;color:#333;margin:0">${esc(d.qrCouponText || '스캔하고 할인 받으세요!')}</p>
    <p style="font-size:11px;color:#999;margin-top:4px">QR 코드를 스마트폰 카메라로 스캔하세요</p>
  </div>`;
}

// ============================================================
// 장바구니 인라인 JS + CSS (Phase 3)
// ★ D154 PHASE 0: 신규 6 엔진 카드 셀렉터 호환 + 옛 엔진 폴백 셀렉터 유지
// ============================================================

export function renderCartScript(d: PageInjectionData): string {
  const apiBase = process.env.FLYER_API_BASE_URL || '';
  const phone = d.trackingPhone || '';
  const flyerId = d.flyerId || '';

  return `
<style>
.cart-fab{position:fixed;bottom:0;left:0;right:0;z-index:9999;padding:12px 16px;display:none;
  background:linear-gradient(135deg,#1a1a2e 0%,#16213e 100%);box-shadow:0 -4px 20px rgba(0,0,0,0.3);
  border-radius:20px 20px 0 0;animation:cartSlideUp .3s ease}
@keyframes cartSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.cart-fab-inner{display:flex;align-items:center;justify-content:space-between;max-width:480px;margin:0 auto}
.cart-info{display:flex;align-items:center;gap:10px;color:#fff}
.cart-badge{background:#ff6b6b;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700}
.cart-text{font-size:14px;line-height:1.3}
.cart-text b{font-size:16px;color:#ffd93d}
.cart-btn{background:linear-gradient(135deg,#ff6b6b,#ee5a24);color:#fff;border:none;padding:10px 24px;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap}
.cart-btn:active{transform:scale(0.95)}
.cart-sheet{position:fixed;inset:0;z-index:10000;display:none}
.cart-overlay{position:absolute;inset:0;background:rgba(0,0,0,0.5)}
.cart-panel{position:absolute;bottom:0;left:0;right:0;max-height:85vh;background:#fff;border-radius:20px 20px 0 0;
  overflow-y:auto;animation:cartSlideUp .3s ease;padding:0 0 env(safe-area-inset-bottom)}
.cart-handle{width:40px;height:4px;background:#ddd;border-radius:2px;margin:12px auto}
.cart-header{padding:0 20px 12px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center}
.cart-header h3{font-size:18px;margin:0}
.cart-clear{font-size:13px;color:#999;background:none;border:none;cursor:pointer}
.cart-items{padding:12px 20px}
.cart-item{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f5f5f5}
.cart-item-img{width:56px;height:56px;border-radius:10px;object-fit:cover;background:#f5f5f5}
.cart-item-info{flex:1;min-width:0}
.cart-item-name{font-size:14px;font-weight:600;color:#333;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cart-item-price{font-size:15px;font-weight:700;color:#ee5a24;margin-top:2px}
.cart-qty{display:flex;align-items:center;gap:8px}
.cart-qty button{width:28px;height:28px;border-radius:50%;border:1px solid #ddd;background:#fff;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center}
.cart-qty span{font-size:14px;min-width:20px;text-align:center}
.cart-footer{padding:16px 20px;border-top:2px solid #f0f0f0;background:#fafafa}
.cart-total{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.cart-total-label{font-size:14px;color:#666}
.cart-total-price{font-size:22px;font-weight:800;color:#1a1a2e}
.cart-order-btn{width:100%;padding:14px;border:none;border-radius:14px;font-size:16px;font-weight:700;color:#fff;
  background:linear-gradient(135deg,#ff6b6b,#ee5a24);cursor:pointer}
.cart-order-btn:active{transform:scale(0.98)}
.cart-order-form{padding:16px 20px}
.cart-form-group{margin-bottom:14px}
.cart-form-group label{display:block;font-size:13px;color:#666;margin-bottom:6px}
.cart-form-group input,.cart-form-group textarea,.cart-form-group select{width:100%;padding:10px 14px;border:1px solid #ddd;border-radius:10px;font-size:14px;font-family:inherit}
.cart-form-group textarea{height:60px;resize:none}
.cart-radio-group{display:flex;gap:10px}
.cart-radio-group label{flex:1;padding:10px;border:2px solid #eee;border-radius:10px;text-align:center;font-size:13px;cursor:pointer}
.cart-radio-group input:checked+label,.cart-radio-group label.sel{border-color:#ee5a24;background:#fff5f2;color:#ee5a24}
.cart-radio-group input{display:none}
.cart-success{text-align:center;padding:40px 20px}
.cart-success h3{font-size:20px;margin:12px 0 8px;color:#333}
.cart-success p{font-size:14px;color:#888}
.add-cart-toast{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.8);color:#fff;
  padding:12px 24px;border-radius:12px;font-size:14px;z-index:10001;animation:toastFade .5s ease forwards;pointer-events:none}
@keyframes toastFade{0%{opacity:0;transform:translate(-50%,-50%) scale(0.8)}20%{opacity:1;transform:translate(-50%,-50%) scale(1)}80%{opacity:1}100%{opacity:0}}
</style>
<div class="cart-fab" id="cartFab">
  <div class="cart-fab-inner">
    <div class="cart-info"><div class="cart-badge" id="cartCount">0</div>
      <div class="cart-text"><span id="cartItemText">0</span>개 상품<br><b id="cartTotalText">0원</b></div>
    </div>
    <button class="cart-btn" onclick="openCartSheet()">장바구니 보기</button>
  </div>
</div>
<div class="cart-sheet" id="cartSheet"><div class="cart-overlay" onclick="closeCartSheet()"></div>
  <div class="cart-panel"><div class="cart-handle"></div><div id="cartContent"></div></div>
</div>
<script>
(function(){
  var API='${apiBase}/api/flyer/cart';
  var PHONE='${phone}';
  var FID='${flyerId}';
  var cart={items:[]};
  function fmt(n){return n.toLocaleString();}

  // ★ D154 PHASE 0 — 신규 6 엔진은 [data-product] 강제 박음 (productDataAttr 헬퍼) + 옛 엔진 폴백 클래스
  var cards=document.querySelectorAll('[data-product]');
  if(cards.length===0){
    cards=document.querySelectorAll('.product-card,.deal-card,.story-card,.grid-card,.swipe-card,.poster-card,.card,.cc,.sw-card,.mg-card,.ed-card,.sc-card,.hb-card,.ms-tile,.hb-item');
  }
  cards.forEach(function(el){
    var btn=document.createElement('button');
    btn.textContent='+';
    btn.style.cssText='position:absolute;bottom:6px;right:6px;width:32px;height:32px;border-radius:50%;border:none;background:linear-gradient(135deg,#ff6b6b,#ee5a24);color:#fff;font-size:18px;font-weight:700;cursor:pointer;z-index:10;box-shadow:0 2px 8px rgba(238,90,36,0.4)';
    btn.onclick=function(e){
      e.preventDefault();e.stopPropagation();
      var d=el.getAttribute('data-product');
      if(d){addToCart(JSON.parse(d));return;}
      var nameEl=el.querySelector('[class*=name],[class*=nm],[class*=pname]');
      var priceEl=el.querySelector('[class*=sale],[class*=price],[class*=pr]');
      var imgEl=el.querySelector('img');
      var name=nameEl?nameEl.textContent.trim():'';
      var priceText=priceEl?priceEl.textContent.replace(/[^0-9]/g,''):'0';
      addToCart({name:name,salePrice:parseInt(priceText)||0,originalPrice:0,imageUrl:imgEl?imgEl.src:'',unit:'',category:''});
    };
    el.style.position='relative';
    el.appendChild(btn);
  });

  function addToCart(item){
    if(!PHONE)return;
    var found=false;
    cart.items.forEach(function(c){if(c.productName===item.name&&c.price===item.salePrice){c.quantity++;found=true;}});
    if(!found) cart.items.push({productName:item.name,price:item.salePrice||item.originalPrice,quantity:1,imageUrl:item.imageUrl||'',category:item.category||'',unit:item.unit||''});
    updateFab();showToast(item.name+' 담김');
    fetch(API+'/'+FID+'/add',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({phone:PHONE,item:{productName:item.name,price:item.salePrice||item.originalPrice,quantity:1,imageUrl:item.imageUrl,unit:item.unit}})}).catch(function(){});
  }

  function updateFab(){
    var cnt=cart.items.reduce(function(s,i){return s+i.quantity;},0);
    var total=cart.items.reduce(function(s,i){return s+i.price*i.quantity;},0);
    document.getElementById('cartFab').style.display=cnt>0?'block':'none';
    document.getElementById('cartCount').textContent=cnt;
    document.getElementById('cartItemText').textContent=cnt;
    document.getElementById('cartTotalText').textContent=fmt(total)+'원';
  }

  function showToast(msg){
    var t=document.createElement('div');t.className='add-cart-toast';t.textContent=msg;
    document.body.appendChild(t);setTimeout(function(){t.remove();},600);
  }

  window.openCartSheet=function(){
    document.getElementById('cartSheet').style.display='block';
    renderCartContent();
  };
  window.closeCartSheet=function(){document.getElementById('cartSheet').style.display='none';};

  function renderCartContent(){
    var el=document.getElementById('cartContent');
    if(cart.items.length===0){el.innerHTML='<div style="text-align:center;padding:60px 20px;color:#999">장바구니가 비어있습니다</div>';return;}
    var total=cart.items.reduce(function(s,i){return s+i.price*i.quantity;},0);
    var h='<div class="cart-header"><h3>장바구니</h3><button class="cart-clear" onclick="clearAllCart()">전체 삭제</button></div>';
    h+='<div class="cart-items">';
    cart.items.forEach(function(item,idx){
      h+='<div class="cart-item">';
      h+=item.imageUrl?'<img class="cart-item-img" src="'+item.imageUrl+'">':'<div class="cart-item-img"></div>';
      h+='<div class="cart-item-info"><div class="cart-item-name">'+item.productName+'</div><div class="cart-item-price">'+fmt(item.price)+'원</div></div>';
      h+='<div class="cart-qty"><button onclick="changeQty('+idx+',-1)">−</button><span>'+item.quantity+'</span><button onclick="changeQty('+idx+',1)">+</button></div>';
      h+='</div>';
    });
    h+='</div>';
    h+='<div class="cart-footer"><div class="cart-total"><span class="cart-total-label">총 금액</span><span class="cart-total-price">'+fmt(total)+'원</span></div>';
    h+='<button class="cart-order-btn" onclick="showOrderForm()">주문하기</button></div>';
    el.innerHTML=h;
  }

  window.changeQty=function(idx,delta){
    cart.items[idx].quantity+=delta;
    if(cart.items[idx].quantity<=0) cart.items.splice(idx,1);
    updateFab();renderCartContent();
    syncCart();
  };

  window.clearAllCart=function(){
    cart.items=[];updateFab();renderCartContent();
    fetch(API+'/'+FID+'?phone='+PHONE,{method:'DELETE'}).catch(function(){});
  };

  function syncCart(){
    fetch(API+'/'+FID,{method:'PUT',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({phone:PHONE,items:cart.items})}).catch(function(){});
  }

  window.showOrderForm=function(){
    var total=cart.items.reduce(function(s,i){return s+i.price*i.quantity;},0);
    var el=document.getElementById('cartContent');
    el.innerHTML='<div class="cart-header"><h3>주문정보</h3></div>'+
    '<div class="cart-order-form">'+
    '<div class="cart-form-group"><label>이름</label><input id="oName" placeholder="이름을 입력해주세요"></div>'+
    '<div class="cart-form-group"><label>수령 방법</label>'+
    '<div class="cart-radio-group"><input type="radio" name="pickup" id="pStore" value="store_pickup" checked><label for="pStore" class="sel" onclick="this.parentNode.querySelectorAll(\'label\').forEach(function(l){l.classList.remove(\'sel\')});this.classList.add(\'sel\')">매장 방문</label>'+
    '<input type="radio" name="pickup" id="pDlv" value="delivery"><label for="pDlv" onclick="this.parentNode.querySelectorAll(\'label\').forEach(function(l){l.classList.remove(\'sel\')});this.classList.add(\'sel\')">배달</label></div></div>'+
    '<div class="cart-form-group"><label>요청사항</label><textarea id="oNote" placeholder="요청사항을 입력해주세요"></textarea></div>'+
    '<div class="cart-footer"><div class="cart-total"><span class="cart-total-label">총 금액</span><span class="cart-total-price">'+fmt(total)+'원</span></div>'+
    '<button class="cart-order-btn" onclick="submitOrder()">주문 확정</button></div></div>';
  };

  window.submitOrder=function(){
    var name=document.getElementById('oName').value;
    var pickup=document.querySelector('input[name=pickup]:checked').value;
    var note=document.getElementById('oNote').value;
    fetch(API+'/'+FID+'/order',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({phone:PHONE,customerName:name,pickupType:pickup,note:note})})
    .then(function(r){return r.json();})
    .then(function(){
      cart.items=[];updateFab();
      document.getElementById('cartContent').innerHTML='<div class="cart-success"><div style="font-size:48px">✅</div><h3>주문이 접수되었습니다</h3><p>매장에서 확인 후 연락드리겠습니다</p>'+
      '<button style="margin-top:20px;padding:12px 32px;border:none;border-radius:10px;background:#333;color:#fff;font-size:14px;cursor:pointer" onclick="closeCartSheet()">닫기</button></div>';
    })
    .catch(function(){alert('주문 접수에 실패했습니다. 다시 시도해주세요.');});
  };

  // 초기 장바구니 로드
  if(PHONE){
    fetch(API+'/'+FID+'?phone='+PHONE).then(function(r){return r.json();}).then(function(data){
      if(data.items&&data.items.length>0){cart.items=data.items;updateFab();}
    }).catch(function(){});
  }
})();
</script>`;
}
