import { corsHeaders } from '@supabase/supabase-js/cors'
import { createPeruDocumentLookupHandler } from '../_shared/handlePeruLookup.ts'

Deno.serve(createPeruDocumentLookupHandler({
  getEnv: (name) => Deno.env.get(name),
  corsHeaders,
}))
