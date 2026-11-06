import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICE_NAMES, validateOrderPayload } from '../supabase/functions/_shared/validation.js';

const validOrder = {
  name: 'João da Silva',
  company: 'Empresa Exemplo Ltda.',
  phone: '(61) 99999-1234',
  email: 'joao@empresa.com.br',
  address: 'Rua das Flores, 120, Brasília - DF',
  contactPreference: 'whatsapp',
  description: 'Solicito avaliação técnica para instalação elétrica no galpão da empresa.',
  services: [SERVICE_NAMES[0], SERVICE_NAMES[1]],
  consent: true,
};

test('aceita uma solicitação válida com mais de um serviço', () => {
  const result = validateOrderPayload(validOrder);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.services, [SERVICE_NAMES[0], SERVICE_NAMES[1]]);
});

test('recusa solicitação sem nome, contato, endereço ou descrição', () => {
  const result = validateOrderPayload({ ...validOrder, name: '', phone: '', address: '', description: '' });
  assert.equal(result.ok, false);
  assert.ok(result.errors.length >= 4);
});

test('recusa serviço não cadastrado e sem seleção', () => {
  assert.equal(validateOrderPayload({ ...validOrder, services: [] }).ok, false);
  assert.equal(validateOrderPayload({ ...validOrder, services: ['Serviço inventado'] }).ok, false);
});

test('remove serviços duplicados antes da validação', () => {
  const result = validateOrderPayload({ ...validOrder, services: [SERVICE_NAMES[0], SERVICE_NAMES[0]] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.services, [SERVICE_NAMES[0]]);
});

test('exige consentimento e preferência de contato válida', () => {
  assert.equal(validateOrderPayload({ ...validOrder, consent: false }).ok, false);
  assert.equal(validateOrderPayload({ ...validOrder, contactPreference: 'telegram' }).ok, false);
});

test('normaliza e-mail e telefone para validação', () => {
  const result = validateOrderPayload({ ...validOrder, email: ' JOAO@EMPRESA.COM.BR ', phone: '+55 (61) 99999-1234' });
  assert.equal(result.ok, true);
  assert.equal(result.value.email, 'joao@empresa.com.br');
  assert.equal(result.value.phoneDigits, '5561999991234');
});

test('recusa descrição curta e campos acima dos limites', () => {
  const result = validateOrderPayload({ ...validOrder, description: 'oi', company: 'x'.repeat(161) });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('descrição')));
  assert.ok(result.errors.some((message) => message.includes('empresa')));
});
