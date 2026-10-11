-- Per-user interface preferences, saved so they follow the user to every device:
-- ui_mode = the fun 3D room or the simple (no 3D, no animation) screens; theme = the room's look (app features/theme).
ALTER TABLE users
  ADD COLUMN ui_mode text NOT NULL DEFAULT 'room',
  ADD COLUMN theme text NOT NULL DEFAULT 'cozy',
  ADD CONSTRAINT users_ui_mode_check CHECK (ui_mode IN ('room', 'simple')),
  ADD CONSTRAINT users_theme_check CHECK (theme IN ('cozy', 'pixel', 'sketch', 'neon', 'diner'));
