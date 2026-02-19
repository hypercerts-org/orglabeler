import pino from 'pino'

const logger = pino(
  process.env.NODE_ENV !== 'production'
    ? {
        level: 'info',
        transport: {
          target: 'pino-pretty',
          options: { colorize: true },
        },
      }
    : { level: 'info' }
)

export default logger
