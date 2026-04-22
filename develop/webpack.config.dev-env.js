const { merge } = require('webpack-merge')

const base = require('./webpack.config.dev')

module.exports = merge(base, {
  devServer: {
    allowedHosts: 'auto',
    devMiddleware: {
      index: false,
    },
    proxy: [
      {
        context: '/socket.io/**',
        target: 'http://real-time:3026',
        ws: true,
      },
      {
        // PDF output and content range requests go directly to clsi-nginx
        context: pathname =>
          pathname.includes('/build/') || pathname.includes('/content/'),
        target: 'http://clsi-nginx:8080',
      },
      {
        context: ['!**/*.js', '!**/*.css', '!**/*.json'],
        target: 'http://web:3000',
      },
    ],
  },
})
