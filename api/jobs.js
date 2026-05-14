/**
 * GET /api/jobs
 * 
 * Fetch jobs from Supabase with optional filtering
 * Query params: category, type, location, limit
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { category, type, location, limit = 20, search, source } = req.query;

    let query = supabase
      .from('jobs')
      .select('*')
      .limit(Math.min(parseInt(limit) || 20, 100));

    if (category) {
      query = query.eq('category', category);
    }

    if (type) {
      query = query.eq('type', type);
    }

    if (location) {
      query = query.ilike('location', `%${location}%`);
    }

    if (search) {
      query = query.or(
        `title.ilike.%${search}%,description.ilike.%${search}%`
      );
    }

    if (source) {
      query = query.eq('source', String(source).trim().toLowerCase());
    }

    const { data, error } = await query.order('posted_at', {
      ascending: false,
    });

    if (error) {
      console.error('Supabase error:', error);
      return res.status(500).json({ error: 'Failed to fetch jobs' });
    }

    return res.status(200).json({
      jobs: data || [],
      count: (data || []).length,
    });
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      details: err.message,
    });
  }
}
