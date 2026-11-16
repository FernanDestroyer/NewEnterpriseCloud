import { corsHeaders } from '@supabase/supabase-js/cors'
import { createProjectAnalyzerHandler } from '../_shared/handleProjectAnalyzer.ts'

Deno.serve(createProjectAnalyzerHandler({
  getEnv: name => Deno.env.get(name),
  corsHeaders,
}))
