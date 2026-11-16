require('dotenv').config();
const e = process.env;

module.exports = {
  PORT: Number(e.PORT || 3000),
  SECRET_KEY: e.SECRET_KEY || 'change-this-secret',
  DB_HOST: e.DB_HOST || 'localhost',
  DB_USER: e.DB_USER || 'root',
  DB_PASSWORD: e.DB_PASSWORD || '',
  DB_NAME: e.DB_NAME || 'dairy_db',

  DAIRY_NAME: e.DAIRY_NAME || 'Smart Dairy',
  DEFAULT_COUNTRY_CODE: e.DEFAULT_COUNTRY_CODE || '+91',

  SMS_PROVIDER: (e.SMS_PROVIDER || 'none').toLowerCase(),
  FAST2SMS_KEY: e.FAST2SMS_KEY || '',
  FAST2SMS_ROUTE: e.FAST2SMS_ROUTE || 'q',
  TWILIO_SID: e.TWILIO_SID || '',
  TWILIO_TOKEN: e.TWILIO_TOKEN || '',
  TWILIO_FROM: e.TWILIO_FROM || '',
  TWILIO_WHATSAPP: e.TWILIO_WHATSAPP === '1',

  // Smart alert thresholds (adjust to your dairy's quality standards)
  MIN_FAT: { cow: 3.0, buffalo: 5.0 },
  MIN_SNF: { cow: 8.0, buffalo: 8.5 },
  YIELD_DROP_PCT: 30,   // alert if quantity is 30% below the farmer's recent average
  YIELD_SPIKE_PCT: 50,  // alert if quantity is 50% above it (check the weighing)
};
