import { createClient } from '@supabase/supabase-js';
import scanQR from 'jsqr';

window.UTN = { createClient, scanQR };
