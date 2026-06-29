import next from "eslint-config-next";

export default next({
  rules: {
    "@typescript-eslint/no-explicit-any": "error",
    // Enforce key prop on every element produced inside .map() or other iterators.
    // Catches missing-key issues (like #359) at lint time before they reach review.
    "react/jsx-key": ["error", { checkFragmentShorthand: true, checkKeyMustBeforeSpread: true }],
  },
});
