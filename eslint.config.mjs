import next from "eslint-config-next/core-web-vitals";
const config = [
  ...next,
  { ignores: [".next/**", "node_modules/**"] },
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
    },
  },
];
export default config;
