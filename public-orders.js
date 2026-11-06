(() => {
  'use strict';
  const form = document.getElementById('contactForm');
  const config = window.CONNECTA_CONFIG || {};
  if (!form) return;
  const status = document.getElementById('formStatus');
  const button = document.getElementById('submitBtn');
  const setStatus = (message, kind='') => {
    status.className = 'form-status' + (kind ? ' ' + kind : '');
    status.textContent = message;
  };
  const serviceMap = {
    'Instalações e Manutenções Elétricas':'Instalações e Manutenções Elétricas',
    'Montagem de Quadros Elétricos':'Montagem de Quadros Elétricos',
    'Redes de Dados e Racks':'Redes de Dados e Racks',
    'Detecção de Incêndio':'Detecção de Incêndio',
    'Automação Industrial':'Automação Industrial',
    'Outro':'Outro serviço / avaliação técnica'
  };
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const name=document.getElementById('nome').value.trim();
    const email=document.getElementById('email').value.trim().toLowerCase();
    const phone=document.getElementById('telefone').value.trim();
    const address=document.getElementById('endereco').value.trim();
    const description=document.getElementById('mensagem').value.trim();
    const contactPreference=document.getElementById('preferenciaContato').value;
    const consent=document.getElementById('consentimento').checked;
    const selected=document.getElementById('assunto').selectedOptions[0]?.textContent.trim();
    const service=serviceMap[selected] || serviceMap['Outro'];
    if(name.length<3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || phone.replace(/\D/g,'').length<10 || address.length<5 || description.length<10 || !consent) {
      setStatus('Preencha nome, e-mail, telefone, serviço, local, descrição e autorização de dados.','error-msg');
      return;
    }
    if(document.getElementById('website').value) return;
    button.disabled=true;
    const oldText=button.textContent;
    button.textContent='Enviando solicitação...';
    try {
      const submissionId=crypto.randomUUID();
      const data=new FormData();
      data.append('payload',JSON.stringify({
        name,company:document.getElementById('empresa').value.trim(),email,phone,address,
        contactPreference,description,services:[service],consent:true,website:'',submissionId
      }));
      const response=await fetch(config.supabaseUrl.replace(/\/$/,'')+'/functions/v1/create-order',{
        method:'POST',
        headers:{apikey:config.supabaseAnonKey,Authorization:'Bearer '+config.supabaseAnonKey},
        body:data
      });
      const result=await response.json().catch(()=>({}));
      if(!response.ok || !result.order?.number) throw new Error(result.error || 'Não foi possível registrar o pedido.');
      setStatus('Solicitação '+result.order.number+' registrada. A equipe Connecta entrará em contato em breve.','success');
      form.reset();
    } catch(error) {
      setStatus(error instanceof Error ? error.message : 'Falha ao registrar a solicitação.','error-msg');
    } finally {
      button.disabled=false;
      button.textContent=oldText || 'Enviar mensagem';
    }
  }, true);
})();
