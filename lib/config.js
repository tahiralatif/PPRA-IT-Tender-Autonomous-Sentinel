require('dotenv').config();

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
  keywords: {
    include: [
      'software', 'hardware', 'networking', 'network', ' IT ', 'information technology',
      'computer', 'server', 'database', 'cloud', 'cybersecurity', 'security system',
      'ERP', 'CRM', 'CCTV', 'surveillance', 'bandwidth', 'fiber optic', 'LAN', 'WAN',
      'data center', 'datacentre', 'backup', 'disaster recovery', 'VPN', 'firewall',
      'switch', 'router', 'access point', 'Wi-Fi', 'WiFi', 'internet', 'web development',
      'mobile application', 'app development', 'AI', 'artificial intelligence',
      'machine learning', 'SCADA', 'automation system', 'digital', 'digitization',
      'ICT', 'communication system', 'VSAT', 'satellite', 'telecommunications',
      'telecom', 'POS', 'point of sale', 'biometric', 'attendance system',
      'projector', 'display', 'AV', 'audio visual', 'printing machine', 'copier',
      'scanner', 'UPS', 'power supply', 'server rack', 'structured cabling',
      'GPU', 'cloud infrastructure', 'hosting', 'domain', 'SSL', 'DNS',
      'IT infrastructure', 'IT services', 'IT solutions', 'IT support',
      'cyber security', 'information security', 'data protection',
      'license', 'subscription', 'annual license',
    ],
    // Hard-exclude: when these dominate the title, skip AI classification
    exclude: [
      'food items', 'rice', 'wheat', 'flour', 'milk', 'meat', 'vegetable', 'catering',
      'construction', 'civil works', 'road', 'bridge', 'building construction',
      'medical equipment', 'medicine', 'surgical', 'pharmaceutical',
      'uniform', 'clothing', 'fabric', 'textile',
      'fuel', 'petroleum', 'diesel', 'petrol', 'lubricant',
      'furniture', 'fixture', 'office chair', 'desk',
    ],
  },

  // Database
  db: {
    path: process.env.DB_PATH || './data/pitas.db',
  },

  // Email
  email: {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.EMAIL_FROM || 'alerts@yourdomain.com',
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
