<?php
// Vorlage. Auf dem Server als kerntransformation-config.php in den Ordner legen, der
// public_html enthält (also NEBEN public_html, nicht darin). Dort wird die Datei bei
// Git-Deploys nicht gelöscht und ist vom Web aus nicht abrufbar.

// API-Schlüssel aus https://platform.claude.com (Settings → API Keys)
const ANTHROPIC_API_KEY = 'sk-ant-...';

// Hash des Zugangscodes, den man in der App unter „KI-Begleiter“ einträgt. Erzeugen mit:
//   php -r 'echo password_hash("mein-zugangscode", PASSWORD_DEFAULT), "\n";'
const ACCESS_CODE_HASH = '$2y$10$...';

// Höchstzahl an Anfragen pro Tag (alle Geräte zusammen); eine Sitzung braucht etwa 20–40.
const DAILY_LIMIT = 300;

// Optional:
// const MODEL  = 'claude-opus-5-5';
// const EFFORT = 'low';   // low | medium | high
