import { addons } from '@storybook/manager-api'
import { create } from '@storybook/theming/create'

import './manager.css'

import brandImage from '../public/branding/logo-dark.svg'

const theme = create({
  base: 'light',
  brandTitle: 'DoubleBackSlash',
  brandUrl: '/',
  brandImage,
})

addons.setConfig({ theme })
