-- Per-user animation speed for the 3D room: 'normal', or 'fast' (doors, camera flights and paper lifts take about half
-- as long). Saved on the account like ui_mode and theme.
ALTER TABLE users
  ADD COLUMN motion text NOT NULL DEFAULT 'normal',
  ADD CONSTRAINT users_motion_check CHECK (motion IN ('normal', 'fast'));
