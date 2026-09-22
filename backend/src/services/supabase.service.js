import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const adminClient =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      })
    : null;

export function isSupabaseConfigured() {
  return Boolean(adminClient);
}

function getBearerToken(request) {
  const header = request.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

export async function requireUser(request) {
  if (!adminClient) {
    return null;
  }

  const token = getBearerToken(request);

  if (!token) {
    const error = new Error('Authentication is required for this operation.');
    error.status = 401;
    throw error;
  }

  const { data, error } = await adminClient.auth.getUser(token);

  if (error || !data?.user) {
    const authError = new Error('Invalid or expired Supabase session.');
    authError.status = 401;
    throw authError;
  }

  return data.user;
}

export async function saveInspection(userId, inspection) {
  if (!adminClient) return null;

  const { data, error } = await adminClient
    .from('inspections')
    .insert({
      id: inspection.inspectionId,
      user_id: userId,
      product_name: inspection.productName,
      score: inspection.score,
      status: inspection.status,
      ocr_confidence: inspection.ocrConfidence,
      ocr_provider: inspection.ocrProvider || null,
      extracted_text: inspection.extractedText,
      checks: inspection.checks,
      visual_review_required: Boolean(inspection.visualReviewRequired),
      conditional_review_required: Boolean(inspection.conditionalReviewRequired),
      created_at: inspection.generatedAt,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function listInspections(userId, limit = 25) {
  if (!adminClient) return [];

  const safeLimit = Math.min(Math.max(Number(limit) || 25, 1), 100);

  const { data, error } = await adminClient
    .from('inspections')
    .select(
      'id, product_name, score, status, ocr_confidence, ocr_provider, extracted_text, checks, visual_review_required, conditional_review_required, created_at',
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);

  if (error) throw error;
  return data || [];
}

export async function clearInspections(userId) {
  if (!adminClient) return;

  const { error } = await adminClient
    .from('inspections')
    .delete()
    .eq('user_id', userId);

  if (error) throw error;
}
