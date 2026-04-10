-- Add profile_emoji column to users table
-- Stores a single emoji character that the user can set as their avatar
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS profile_emoji text DEFAULT NULL;
