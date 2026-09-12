import {
  publicConfigDataSchema,
  type PublicConfigData,
} from '../contracts/configuration';

const defaultConfigurationCandidate = {
  revision: 0,
  source: 'default',
  brand: {
    name: 'HortiVitalMix',
    tagline: 'Do produtor local para a sua mesa',
    pageTitle: 'HortiVitalMix | Do produtor local para a sua mesa',
    logoAltText: 'HortiVitalMix - do produtor local para a sua mesa',
    theme: {
      primary: '#0F4D2F',
      secondary: '#78A936',
      accent: '#EF6500',
    },
  },
  contacts: {
    email: null,
    phone: null,
    whatsapp: null,
  },
  region: {
    countryCode: 'BR',
    stateCode: 'RO',
    city: 'Ariquemes',
  },
  parameters: {
    locale: 'pt-BR',
    currency: 'BRL',
    timezone: 'America/Porto_Velho',
  },
} satisfies PublicConfigData;

export const DEFAULT_GLOBAL_CONFIGURATION: PublicConfigData =
  publicConfigDataSchema.parse(defaultConfigurationCandidate);
