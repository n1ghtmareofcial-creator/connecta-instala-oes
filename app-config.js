/*
 * Configuração pública do navegador.
 * A publishable/anon key é própria para clientes web quando todas as tabelas usam RLS.
 * NUNCA coloque SUPABASE_SERVICE_ROLE_KEY, tokens Meta ou senhas neste arquivo.
 */
window.CONNECTA_CONFIG = Object.freeze({
  supabaseUrl: 'https://rzahesgzeyzuvmibhvul.supabase.co',
  supabaseAnonKey: 'sb_publishable_6JYKaePWmpetR29Nx8e0Fg_sHpgNH03',
  businessWhatsAppPhone: '556186063653',
  maxFiles: 5,
  maxFileBytes: 5 * 1024 * 1024,
  maxTotalFileBytes: 5 * 1024 * 1024,
});
