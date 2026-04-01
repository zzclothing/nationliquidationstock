const { createApp } = require("./app2");

const PORT = Number(process.env.PORT || 3000);

createApp()
  .then((app) => {
    app.listen(PORT, () => {
      console.log(`Nation Liquidation Stock running on http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Failed to start Nation Liquidation Stock", error);
    process.exit(1);
  });
