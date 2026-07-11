const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  // Scraper settings
  scrape: {
    delayMs: parseInt(process.env.SCRAPE_DELAY_MS) || 3000,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 2,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  },

  // Portal URLs
  portals: {
    epms: {
      name: 'epms',
      base: 'https://epms.ppra.gov.pk',
      listing: '/public/tenders/active-tenders',
      detail: '/public/tenders/tender-details',
      // sector=14 = "Info and Comm Tech"
      sectorFilter: '14',
    },
    epads: {
      name: 'epads',
      base: 'https://epads.gov.pk',
      listing: '/',
      detail: '/opportunities/federal/procurements',
    },
  },

  // IT-relevant keyword list (hard-include)
  // Focused on core IT/software/hardware/networking/cloud/cybersecurity.
  // Removed overly broad terms that cause false positives (e.g. 'printer', 'scanner').
  keywords: {
    include: [
      // Software
      'software', 'ERP system', 'ERP software', 'ERP solution',
      'CRM', 'web development', 'mobile application', 'app development',
      'AI platform', 'artificial intelligence', 'machine learning',

      // Hardware / Computing
      'hardware', 'laptop', 'server', 'database', 'GPU',
      'computer network', 'computer hardware', 'computer software',
      'computer system', 'computer server',

      // Networking
      'networking', 'network', 'switch', 'router', 'access point',
      'Wi-Fi', 'WiFi', 'firewall', 'VPN', 'bandwidth',
      'fiber optic', 'structured cabling', 'server rack',
      'VSAT', 'satellite',

      // Cloud / Hosting / Internet
      'cloud', 'cloud infrastructure', 'hosting', 'domain',
      'SSL', 'DNS', 'IPv4', 'IPv6', 'IP address',

      // Security (cybersecurity only — physical security excluded)
      'cybersecurity', 'cyber security', 'information security',
      'data protection', 'managed security',
      'ISO 27001', 'ISO/IEC 27001',

      // Communications / Telecom
      'ICT', 'telecommunications', 'telecom',
      'PABX', 'IP PABX', 'internet',

      // Digital / Data
      'digital', 'digitization', 'data center', 'datacentre',
      'backup', 'disaster recovery',

      // Surveillance (IT-related CCTV only — see exclude for physical security)
      'CCTV', 'surveillance',

      // Biometrics / Access Control
      'biometric', 'attendance system',

      // AV (IT-related only)
      'audio visual',

      // IT services
      'IT infrastructure', 'IT services', 'IT solutions', 'IT support',
      'IT stores',
    ],

    // Hard-exclude: when these dominate the title, skip AI classification
    exclude: [
      // Food / Catering
      'food items', 'rice', 'wheat', 'flour', 'milk', 'meat', 'vegetable',
      'catering', 'dry ration', 'cooking oil', 'spices',
      'food', 'catering services',

      // Construction / Civil Works
      'construction', 'civil works', 'road', 'bridge', 'building construction',
      'renovation', 'repair works', 'plumbing', 'electrical works',
      'interior design', 'fit-out', 'carpet', 'painting',

      // Medical / Pharma
      'medical equipment', 'medical supplies', 'medicine', 'surgical',
      'pharmaceutical', 'medical',
      'hospital', 'clinic', 'laboratory', 'lab equipment', 'reagent',

      // Textiles / Uniforms
      'uniform', 'clothing', 'fabric', 'textile', 'garment',

      // Fuel / Energy
      'fuel', 'petroleum', 'diesel', 'petrol', 'lubricant',
      'generator', 'solar panel', 'solar system', 'power plant',
      'UPS system', 'transformer',

      // Furniture / Office Supplies
      'furniture', 'fixture', 'office chair', 'desk', 'office table',
      'office supplies', 'stationery', 'paper', 'printing paper',

      // Vehicles
      'vehicle', 'automobile', 'car', 'jeep', 'truck', 'bus',
      'motorcycle', 'ambulance',

      // HVAC
      'air conditioner', 'HVAC', 'air conditioning', 'chiller',

      // Water / Environment
      'water supply', 'sewerage', 'drainage', 'water treatment',
      'waste management', 'solid waste',

      // Printing / Photocopying (NOT IT)
      'printer', 'printing machine', 'printing press', 'photocopier',
      'photocopy', 'printing machine', 'xerox', 'copier', 'scanner',

      // Security Guards / Physical Security (NOT cybersecurity)
      'security guard', 'security guard services', 'guarding services',
      'armed security', 'security personnel',
      'security system', 'security services',
    ],
  },

  // Database
  db: {
    path: process.env.DB_PATH || './data/pitas.db',
  },

  // Email (Gmail SMTP)
  email: {
    smtpUser: process.env.GMAIL_USER,
    smtpPass: process.env.GMAIL_APP_PASSWORD,
    fromName: process.env.EMAIL_FROM_NAME || 'PITAS Tender Alert',
  },

  // Admin
  admin: {
    email: process.env.ADMIN_EMAIL,
  },

  // Site URL
  siteUrl: process.env.SITE_URL || 'http://localhost:3000',

  // Paths
  paths: {
    snapshots: './snapshots',
    logs: './logs',
  },
};
