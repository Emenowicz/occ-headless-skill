export default defineNuxtConfig({
  modules: ['@pinia/nuxt'],
  runtimeConfig: {
    public: {
      occBaseUrl: '',      // NUXT_PUBLIC_OCC_BASE_URL
      occSite: 'electronics',
      occClientId: '',     // NUXT_PUBLIC_OCC_CLIENT_ID
      occClientSecret: '', // NUXT_PUBLIC_OCC_CLIENT_SECRET
    },
  },
});
