<script setup lang="ts">
const route = useRoute();
const config = useRuntimeConfig();
const { data: product } = await useFetch<any>(
  `${config.public.occBaseUrl}/occ/v2/${config.public.occSite}/products/${route.params.code}`,
  { query: { fields: 'code,name,price(formattedValue),images(DEFAULT)' } },
);
</script>

<template>
  <article v-if="product">
    <h1>{{ product.name }}</h1>
    <p>{{ product.price?.formattedValue }}</p>
  </article>
</template>
