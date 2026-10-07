const addresses = {
  STOCK_ADDRESS: import.meta.env.VITE_STOCK_ADDRESS,
  USD_ADDRESS: import.meta.env.VITE_USD_ADDRESS,
  SPLITTER_ADDRESS: import.meta.env.VITE_SPLITTER_ADDRESS,
  PRICE_LEG_ADDRESS: import.meta.env.VITE_PRICE_LEG_ADDRESS,
  DIV_LEG_ADDRESS: import.meta.env.VITE_DIV_LEG_ADDRESS,
  POOL_PRICE_ADDRESS: import.meta.env.VITE_POOL_PRICE_ADDRESS,
  POOL_DIV_ADDRESS: import.meta.env.VITE_POOL_DIV_ADDRESS,
  ORACLE_ADDRESS: import.meta.env.VITE_ORACLE_ADDRESS,
} as const

export default addresses
