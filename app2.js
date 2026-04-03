const express = require("express");
const session = require("express-session");
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { v2: cloudinary } = require("cloudinary");
const { promisify } = require("util");

const app = express();
app.set("trust proxy", 1);
const scrypt = promisify(crypto.scrypt);
const SITE_NAME = "Nation Liquidation Stock";
const WHATSAPP_NUMBER = "12294293042";
const DEFAULT_CATEGORIES = ["Electronics", "Clothing", "Mixed", "Home Goods"];
const CONDITIONS = ["Returns", "Overstock", "Mixed"];
const SHIPPING_OPTIONS = [{ value: "freight", label: "Freight delivery" }, { value: "pickup", label: "Local pickup" }];
const SORT_OPTIONS = [{ value: "featured", label: "Featured first" }, { value: "price_asc", label: "Price: low to high" }, { value: "price_desc", label: "Price: high to low" }, { value: "quantity_desc", label: "Most inventory" }, { value: "newest", label: "Newest arrivals" }];
const LOCALES = [{ value: "en", label: "EN" }, { value: "es", label: "ES" }, { value: "fr", label: "FR" }];
const DICTIONARIES = {
  en: require("./locales/en.json"),
  es: require("./locales/es.json"),
  fr: require("./locales/fr.json")
};
const CATEGORY_LABEL_KEYS = { "Electronics": "category_electronics", "Clothing": "category_clothing", "Mixed": "category_mixed", "Home Goods": "category_home_goods" };
const CONDITION_LABEL_KEYS = { "Returns": "condition_returns", "Overstock": "condition_overstock", "Mixed": "condition_mixed" };
const UNIT_LABEL_KEYS = { pallet: "unit_pallet", truckload: "unit_truckload" };
const SORT_LABEL_KEYS = { featured: "sort_featured", price_asc: "sort_price_asc", price_desc: "sort_price_desc", quantity_desc: "sort_quantity_desc", newest: "sort_newest" };
const DATA_DIR = path.join(process.cwd(), "data");
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const PRODUCT_FALLBACK_IMAGE = "/images/products/mixed-gm-1.svg";
const CLOUDINARY_ENABLED = Boolean(process.env.CLOUDINARY_URL || (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET));
if (CLOUDINARY_ENABLED) {
  if (process.env.CLOUDINARY_URL) {
    cloudinary.config(process.env.CLOUDINARY_URL);
  } else {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
      secure: true
    });
  }
}
const FILES = {
  users: path.join(DATA_DIR, "users.json"),
  categories: path.join(DATA_DIR, "categories.json"),
  products: path.join(DATA_DIR, "products.json"),
  orders: path.join(DATA_DIR, "orders.json"),
  reviews: path.join(DATA_DIR, "reviews.json"),
  inquiries: path.join(DATA_DIR, "inquiries.json"),
  emailVerifications: path.join(DATA_DIR, "email-verifications.json"),
  passwordResets: path.join(DATA_DIR, "password-resets.json")
};
const storage = multer.diskStorage({
  destination(req, file, callback) { callback(null, UPLOAD_DIR); },
  filename(req, file, callback) { callback(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname) || ".jpg"}`); }
});
const upload = multer({
  storage,
  fileFilter(req, file, callback) {
    if (!file.mimetype.startsWith("image/")) return callback(new Error("Only image uploads are allowed."));
    return callback(null, true);
  }
});
const writeQueue = new Map();
const collectionCache = new Map();
const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function sanitize(value, maxLength = 5000) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, maxLength); }
function parseList(value) { return (Array.isArray(value) ? value : String(value || "").split(/\r?\n|,/)).map((entry) => sanitize(entry, 200)).filter(Boolean); }
function slugify(value) { return sanitize(value, 160).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90); }
function formatCurrency(cents = 0) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((Number(cents) || 0) / 100); }
function createToken() { return crypto.randomBytes(24).toString("hex"); }
function normalizeUploadedFiles(files) {
  if (!files) return [];
  const list = Array.isArray(files) ? files : Object.values(files).flat();
  return list.filter((file) => file && ((file.buffer && file.buffer.length > 0) || (file.size && file.size > 0) || file.path));
}
async function uploadImageFile(file) {
  if (!CLOUDINARY_ENABLED) return file?.path ? `/uploads/${path.basename(file.path)}` : null;
  if (!file.buffer || file.buffer.length === 0) {
    if (file.path) {
      const diskBuffer = await fs.readFile(file.path);
      if (!diskBuffer || diskBuffer.length === 0) return null;
      file.buffer = diskBuffer;
    } else {
      return null;
    }
  }
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: "nation-liquidation-stock/products",
        resource_type: "image"
      },
      (error, result) => {
        if (error) return reject(error);
        resolve(result.secure_url);
      }
    );
    stream.end(file.buffer);
  });
}
async function uploadProductImages(files = []) {
  if (!Array.isArray(files) || files.length === 0) return [];
  const uploaded = await Promise.all(files.map(uploadImageFile));
  return uploaded.filter(Boolean);
}
function createWhatsAppUrl(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}


function buildOrderWhatsAppMessage(order) {
  const item = order.items[0];
  const address = order.shippingOption === "pickup"
    ? "Local pickup requested"
    : `${order.shippingAddress.address1}, ${order.shippingAddress.city}, ${order.shippingAddress.state}, ${order.shippingAddress.postalCode}`;
  return [
    `New order from Nation Liquidation Stock`,
    `Order ID: ${order.id}`,
    `Buyer: ${order.buyerName}`,
    `Company: ${order.company}`,
    `Email: ${order.email}`,
    `Product: ${item.title}`,
    `Quantity: ${item.quantity} ${item.unitType}(s)`,
    `Unit Price: ${formatCurrency(item.unitPriceCents)}`,
    `Shipping: ${order.shippingLabel}`,
    `Shipping Address: ${address}`,
    `Payment: ${order.paymentMethod}`,
    `Total: ${formatCurrency(order.totalCents)}`
  ].join("\n");
}
function buildInquiryWhatsAppMessage(inquiry) {
  return [
    `New buyer inquiry from Nation Liquidation Stock`,
    `Name: ${inquiry.name}`,
    `Company: ${inquiry.company}`,
    `Email: ${inquiry.email}`,
    inquiry.productId ? `Product ID: ${inquiry.productId}` : "Product ID: General inquiry",
    `Message: ${inquiry.message}`
  ].join("\n");
}
function t(locale, key) { return DICTIONARIES[locale]?.[key] || DICTIONARIES.en[key] || key; }
function pickLocale(req) {
  const sessionLocale = req.session?.locale;
  if (LOCALES.some((entry) => entry.value === sessionLocale)) return sessionLocale;
  const detected = (req.get("accept-language") || "").split(",").map((entry) => entry.trim().slice(0, 2).toLowerCase()).find((value) => LOCALES.some((entry) => entry.value === value));
  return detected || "en";
}
function parseMoneyToCents(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0; }
function normalizeCategoryName(value) { return sanitize(value, 60); }
async function getCategories() {
  const categories = await readCollection("categories");
  if (Array.isArray(categories) && categories.length) return categories;
  await writeCollection("categories", [...DEFAULT_CATEGORIES]);
  return [...DEFAULT_CATEGORIES];
}
function estimateShipping({ shippingOption = "freight", postalCode = "", quantity = 1, unitType = "pallet" }) {
  const qty = Math.max(Number(quantity) || 1, 1);
  if (shippingOption === "pickup") return { amountCents: 0, label: "Local pickup", eta: "Ready in 2 business days" };
  const zone = String(postalCode || "").replace(/\D/g, "").split("").map(Number).reduce((total, value) => total + value, 0) % 5;
  const base = unitType === "truckload" ? 48500 : 18900;
  const perUnit = unitType === "truckload" ? 18000 : 4500;
  return { amountCents: base + zone * 2700 + perUnit * qty, label: "Freight delivery", eta: zone >= 3 ? "5-8 business days" : "3-5 business days" };
}
async function hashPassword(password) { const salt = crypto.randomBytes(16).toString("hex"); const key = await scrypt(password, salt, 64); return `scrypt$${salt}$${key.toString("hex")}`; }
async function verifyPassword(password, storedHash) {
  if (!storedHash) return false;
  if (storedHash.startsWith("seed:")) return password === storedHash.slice(5);
  const [, salt, key] = String(storedHash).split("$");
  if (!salt || !key) return false;
  const derived = await scrypt(password, salt, 64);
  const stored = Buffer.from(key, "hex");
  return stored.length === derived.length && crypto.timingSafeEqual(stored, Buffer.from(derived));
}
async function ensureFile(filePath) { try { await fs.access(filePath); } catch (error) { await fs.writeFile(filePath, "[]\n", "utf8"); } }
async function readCollection(name) { return JSON.parse(await fs.readFile(FILES[name], "utf8")); }
async function writeCollection(name, value) {
  const previous = writeQueue.get(name) || Promise.resolve();
  const next = previous.then(() => fs.writeFile(FILES[name], `${JSON.stringify(value, null, 2)}\n`, "utf8"));
  writeQueue.set(name, next.catch(() => undefined));
  await next;
}
async function initializeStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  await Promise.all(Object.values(FILES).map(ensureFile));
  const users = await readCollection("users");
  let changed = false;
  for (const user of users) {
    if (user.seedPassword) { user.passwordHash = await hashPassword(user.seedPassword); delete user.seedPassword; changed = true; }
    if (!Array.isArray(user.savedProductIds)) { user.savedProductIds = []; changed = true; }
  }
  if (changed) await writeCollection("users", users);
}
function requireAuth(req, res, next) { if (!req.currentUser) { req.flash("error", "Please log in to continue."); return res.redirect("/login"); } return next(); }
function requireAdmin(req, res, next) { if (!req.currentUser || req.currentUser.role !== "admin") { req.flash("error", "Admin access is required."); return res.redirect(req.currentUser ? "/" : "/login"); } return next(); }
function requireVerifiedBuyer(req, res, next) { if (!req.currentUser) { req.flash("error", "Please log in to continue."); return res.redirect("/login"); } if (req.currentUser.role !== "buyer") { req.flash("error", "Buyer access is required."); return res.redirect("/"); } if (!req.currentUser.emailVerified) { req.flash("error", "Verify your email before purchasing."); return res.redirect("/dashboard"); } return next(); }
function validateRegistration(body) {
  const value = { name: sanitize(body.name, 120), company: sanitize(body.company, 120), email: sanitize(body.email, 160).toLowerCase(), password: String(body.password || "") };
  const errors = [];
  if (!value.name) errors.push("Full name is required.");
  if (!value.company) errors.push("Company name is required.");
  if (!/^\S+@\S+\.\S+$/.test(value.email)) errors.push("A valid email is required.");
  if (value.password.length < 8) errors.push("Password must be at least 8 characters.");
  return { errors, value };
}
function validateLogin(body) {
  const value = { email: sanitize(body.email, 160).toLowerCase(), password: String(body.password || "") };
  const errors = [];
  if (!value.email) errors.push("Email is required.");
  if (!value.password) errors.push("Password is required.");
  return { errors, value };
}
function validateInquiry(body) {
  const value = { name: sanitize(body.name, 120), company: sanitize(body.company, 120), email: sanitize(body.email, 160).toLowerCase(), message: sanitize(body.message, 1000), honeypot: sanitize(body.website, 120), productId: sanitize(body.productId, 120) };
  const errors = [];
  if (value.honeypot) errors.push("Spam detected.");
  if (!value.name) errors.push("Name is required.");
  if (!value.company) errors.push("Company is required.");
  if (!/^\S+@\S+\.\S+$/.test(value.email)) errors.push("A valid email is required.");
  if (!value.message) errors.push("Message is required.");
  return { errors, value };
}
function validateReview(body) {
  const value = { rating: Math.min(Math.max(Number.parseInt(body.rating, 10) || 0, 0), 5), title: sanitize(body.title, 100), comment: sanitize(body.comment, 800) };
  const errors = [];
  if (!value.rating) errors.push("Choose a star rating.");
  if (!value.comment) errors.push("Review comments are required.");
  return { errors, value };
}
function validateCheckout(body) {
  const value = {
    quantity: Math.max(Number.parseInt(body.quantity, 10) || 0, 0),
    shippingOption: body.shippingOption === "pickup" ? "pickup" : "freight",
    contactName: sanitize(body.contactName, 120),
    company: sanitize(body.company, 120),
    email: sanitize(body.email, 160).toLowerCase(),
    address1: sanitize(body.address1, 160),
    city: sanitize(body.city, 100),
    state: sanitize(body.state, 100),
    postalCode: sanitize(body.postalCode, 30),
    paymentMethod: body.paymentMethod === "stripe" ? "stripe" : "mock_card"
  };
  const errors = [];
  if (value.quantity < 1) errors.push("Quantity must be at least 1.");
  if (!value.contactName) errors.push("Contact name is required.");
  if (!value.company) errors.push("Company name is required.");
  if (!/^\S+@\S+\.\S+$/.test(value.email)) errors.push("A valid email is required.");
  if (value.shippingOption === "freight") {
    if (!value.address1) errors.push("Street address is required for freight delivery.");
    if (!value.city) errors.push("City is required for freight delivery.");
    if (!value.state) errors.push("State is required for freight delivery.");
    if (!value.postalCode) errors.push("Postal code is required for freight delivery.");
  }
  return { errors, value };
}
async function validateProduct(body, uploadedUrls = [], existing = null) {
  const categories = await getCategories();
  const imageUrls = parseList(body.imageUrls);
  const normalizedUploads = (Array.isArray(uploadedUrls) ? uploadedUrls : []).map((entry) => sanitize(entry, 500)).filter(Boolean);
  const value = {
    title: sanitize(body.title, 140),
    description: sanitize(body.description, 4000),
    category: normalizeCategoryName(body.category),
    condition: sanitize(body.condition, 60),
    unitType: body.unitType === "truckload" ? "truckload" : "pallet",
    priceCents: parseMoneyToCents(body.price),
    quantityAvailable: Math.max(Number.parseInt(body.quantityAvailable, 10) || 0, 0),
    images: [...new Set([...(existing?.images || []), ...imageUrls, ...normalizedUploads])],
    manifest: parseList(body.manifest),
    featured: body.featured === "on" || body.featured === true || body.featured === "true"
  };
  const errors = [];
  if (!value.title) errors.push("Title is required.");
  if (!value.description) errors.push("Description is required.");
  if (!categories.includes(value.category)) errors.push("Choose a valid category.");
  if (!CONDITIONS.includes(value.condition)) errors.push("Choose a valid condition.");
  if (!value.priceCents) errors.push("Price must be greater than zero.");
  if (value.quantityAvailable < 1) errors.push("Quantity must be at least 1.");
  if (value.images.length === 0) errors.push("Add at least one image URL or upload.");
  return { errors, value };
}
async function issueVerification(userId) {
  const records = await readCollection("emailVerifications");
  const fresh = records.filter((entry) => entry.userId !== userId && new Date(entry.expiresAt) > new Date());
  const token = createToken();
  fresh.push({ id: crypto.randomUUID(), userId, token, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString() });
  await writeCollection("emailVerifications", fresh);
  return token;
}
async function latestVerificationFor(userId) {
  const records = await readCollection("emailVerifications");
  return records.filter((entry) => entry.userId === userId && new Date(entry.expiresAt) > new Date()).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))[0] || null;
}
function enrichProducts(products, reviews) {
  return products.map((product) => {
    const matches = reviews.filter((review) => review.productId === product.id);
    return { ...product, reviewCount: matches.length, ratingAverage: matches.length ? matches.reduce((total, review) => total + review.rating, 0) / matches.length : 0 };
  });
}
async function getCatalog(filters = {}) {
  const [products, reviews, categories] = await Promise.all([readCollection("products"), readCollection("reviews"), getCategories()]);
  let catalog = enrichProducts(products, reviews);
  const keyword = sanitize(filters.q || filters.keyword, 120).toLowerCase();
  if (keyword) catalog = catalog.filter((product) => [product.title, product.description, product.category, product.condition, ...(product.manifest || [])].join(" ").toLowerCase().includes(keyword));
  if (filters.category && categories.includes(filters.category)) catalog = catalog.filter((product) => product.category === filters.category);
  if (filters.condition && CONDITIONS.includes(filters.condition)) catalog = catalog.filter((product) => product.condition === filters.condition);
  if (filters.minPrice) { const min = parseMoneyToCents(filters.minPrice); if (min) catalog = catalog.filter((product) => product.priceCents >= min); }
  if (filters.maxPrice) { const max = parseMoneyToCents(filters.maxPrice); if (max) catalog = catalog.filter((product) => product.priceCents <= max); }
  switch (filters.sort) {
    case "price_asc": catalog.sort((left, right) => left.priceCents - right.priceCents); break;
    case "price_desc": catalog.sort((left, right) => right.priceCents - left.priceCents); break;
    case "quantity_desc": catalog.sort((left, right) => right.quantityAvailable - left.quantityAvailable); break;
    case "newest": catalog.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)); break;
    default: catalog.sort((left, right) => Number(right.featured) - Number(left.featured) || new Date(right.createdAt) - new Date(left.createdAt));
  }
  return catalog;
}
async function getProduct(identifier) {
  const [products, reviews, users] = await Promise.all([readCollection("products"), readCollection("reviews"), readCollection("users")]);
  const product = products.find((entry) => entry.id === identifier || entry.slug === identifier);
  if (!product) return null;
  const enriched = enrichProducts([product], reviews)[0];
  const productReviews = reviews.filter((review) => review.productId === product.id).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt)).map((review) => ({ ...review, buyerName: users.find((user) => user.id === review.buyerId)?.name || "Verified buyer" }));
  return { ...enriched, reviews: productReviews };
}
async function buildAnalytics() {
  const [users, products, orders, inquiries] = await Promise.all([readCollection("users"), readCollection("products"), readCollection("orders"), readCollection("inquiries")]);
  const paidOrders = orders.filter((order) => order.paymentStatus === "paid");
  const counts = {};
  for (const order of paidOrders) for (const item of order.items) counts[item.productId] = (counts[item.productId] || 0) + item.quantity;
  return {
    totalSalesCents: paidOrders.reduce((total, order) => total + order.totalCents, 0),
    ordersCount: paidOrders.length,
    buyersCount: users.filter((user) => user.role === "buyer").length,
    inventoryUnits: products.reduce((total, product) => total + product.quantityAvailable, 0),
    palletsSold: paidOrders.reduce((total, order) => total + order.items.reduce((sum, item) => sum + item.quantity, 0), 0),
    openInquiries: inquiries.filter((inquiry) => inquiry.status === "open").length,
    popularProducts: Object.entries(counts).sort((left, right) => right[1] - left[1]).slice(0, 5).map(([productId, quantity]) => ({ productId, quantity, title: products.find((product) => product.id === productId)?.title || "Archived product" }))
  };
}
async function createBuyer(value) {
  const users = await readCollection("users");
  if (users.some((user) => user.email.toLowerCase() === value.email)) throw new Error("An account with that email already exists.");
  const user = { id: crypto.randomUUID(), role: "buyer", name: value.name, company: value.company, email: value.email, passwordHash: await hashPassword(value.password), emailVerified: false, savedProductIds: [], createdAt: new Date().toISOString() };
  users.push(user);
  await writeCollection("users", users);
  return { user, token: await issueVerification(user.id) };
}
async function authenticateUser(email, password) {
  const users = await readCollection("users");
  const user = users.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
  return user && await verifyPassword(password, user.passwordHash) ? user : null;
}
async function consumeVerification(token) {
  const [users, records] = await Promise.all([readCollection("users"), readCollection("emailVerifications")]);
  const match = records.find((record) => record.token === token && new Date(record.expiresAt) > new Date());
  if (!match) return false;
  const user = users.find((entry) => entry.id === match.userId);
  if (!user) return false;
  user.emailVerified = true;
  await Promise.all([writeCollection("users", users), writeCollection("emailVerifications", records.filter((record) => record.token !== token))]);
  return true;
}
async function requestPasswordReset(email) {
  const [users, resets] = await Promise.all([readCollection("users"), readCollection("passwordResets")]);
  const user = users.find((entry) => entry.email.toLowerCase() === email.toLowerCase());
  if (!user) return null;
  const fresh = resets.filter((entry) => entry.userId !== user.id && new Date(entry.expiresAt) > new Date());
  const token = createToken();
  fresh.push({ id: crypto.randomUUID(), userId: user.id, token, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString() });
  await writeCollection("passwordResets", fresh);
  return token;
}
async function applyPasswordReset(token, password) {
  const [users, resets] = await Promise.all([readCollection("users"), readCollection("passwordResets")]);
  const match = resets.find((entry) => entry.token === token && new Date(entry.expiresAt) > new Date());
  if (!match) return false;
  const user = users.find((entry) => entry.id === match.userId);
  if (!user) return false;
  user.passwordHash = await hashPassword(password);
  await Promise.all([writeCollection("users", users), writeCollection("passwordResets", resets.filter((entry) => entry.token !== token))]);
  return true;
}
async function toggleSavedProduct(userId, productId) {
  const users = await readCollection("users");
  const user = users.find((entry) => entry.id === userId);
  if (!user) return false;
  const hasSaved = user.savedProductIds.includes(productId);
  user.savedProductIds = hasSaved ? user.savedProductIds.filter((entry) => entry !== productId) : [...user.savedProductIds, productId];
  await writeCollection("users", users);
  return !hasSaved;
}
async function addInquiry(value) {
  const inquiries = await readCollection("inquiries");
  const inquiry = { id: crypto.randomUUID(), ...value, status: "open", createdAt: new Date().toISOString() };
  inquiries.unshift(inquiry);
  await writeCollection("inquiries", inquiries);
  return inquiry;
}
async function addReview(userId, productId, value) {
  const [orders, reviews] = await Promise.all([readCollection("orders"), readCollection("reviews")]);
  const purchased = orders.some((order) => order.buyerId === userId && order.items.some((item) => item.productId === productId));
  if (!purchased) throw new Error("Only buyers who purchased this load can leave a review.");
  if (reviews.some((review) => review.buyerId === userId && review.productId === productId)) throw new Error("You already reviewed this load.");
  reviews.unshift({ id: crypto.randomUUID(), productId, buyerId: userId, rating: value.rating, title: value.title, comment: value.comment, createdAt: new Date().toISOString() });
  await writeCollection("reviews", reviews);
}
async function createCategory(name) {
  const categories = await getCategories();
  const nextName = normalizeCategoryName(name);
  if (!nextName) throw new Error("Category name is required.");
  if (categories.some((entry) => entry.toLowerCase() === nextName.toLowerCase())) throw new Error("That category already exists.");
  const nextCategories = [...categories, nextName].sort((left, right) => left.localeCompare(right));
  await writeCollection("categories", nextCategories);
}
async function updateCategory(currentName, nextName) {
  const categories = await getCategories();
  const existingName = normalizeCategoryName(currentName);
  const replacementName = normalizeCategoryName(nextName);
  if (!existingName) throw new Error("Current category is required.");
  if (!replacementName) throw new Error("New category name is required.");
  if (!categories.includes(existingName)) throw new Error("Category not found.");
  if (existingName.toLowerCase() !== replacementName.toLowerCase() && categories.some((entry) => entry.toLowerCase() === replacementName.toLowerCase())) throw new Error("That category already exists.");
  const products = await readCollection("products");
  const nextCategories = categories.map((entry) => entry === existingName ? replacementName : entry).sort((left, right) => left.localeCompare(right));
  const nextProducts = products.map((product) => product.category === existingName ? { ...product, category: replacementName, updatedAt: new Date().toISOString() } : product);
  await Promise.all([writeCollection("categories", nextCategories), writeCollection("products", nextProducts)]);
}
async function deleteCategory(name) {
  const categories = await getCategories();
  const targetName = normalizeCategoryName(name);
  if (!targetName) throw new Error("Category name is required.");
  if (!categories.includes(targetName)) throw new Error("Category not found.");
  const products = await readCollection("products");
  if (products.some((product) => product.category === targetName)) throw new Error("Remove or reassign products using this category before deleting it.");
  if (categories.length <= 1) throw new Error("At least one category must remain.");
  await writeCollection("categories", categories.filter((entry) => entry !== targetName));
}
async function saveProductRecord(existingId, body, files = [], existingFromRoute = null) {
  const products = await readCollection("products");
  const existing = existingFromRoute || products.find((entry) => entry.id === existingId) || null;
  let uploadedUrls = [];
  try {
    uploadedUrls = await uploadProductImages(files);
  } catch (error) {
    return { errors: [error.message || "Image upload failed."], product: { ...(existing || {}), ...body, images: existing?.images || [] } };
  }
  const parsed = await validateProduct(body, uploadedUrls, existing);
  if (parsed.errors.length) return { errors: parsed.errors, product: { ...(existing || {}), ...body, images: existing?.images || [] } };
  const slugBase = slugify(parsed.value.title) || crypto.randomUUID();
  const product = { id: existing ? existing.id : crypto.randomUUID(), slug: existing ? existing.slug : slugBase, soldAsIs: true, createdAt: existing ? existing.createdAt : new Date().toISOString(), updatedAt: new Date().toISOString(), ...parsed.value };
  if (products.some((entry) => entry.slug === product.slug && entry.id !== product.id)) product.slug = `${slugBase}-${product.id.slice(0, 6)}`;
  const nextProducts = existing ? products.map((entry) => entry.id === product.id ? product : entry) : [product, ...products];
  await writeCollection("products", nextProducts);
  return { product, errors: [] };
}
async function removeProduct(productId) {
  const products = await readCollection("products");
  await writeCollection("products", products.filter((entry) => entry.id !== productId));
}
async function checkoutProduct(user, productId, value) {
  const [products, orders] = await Promise.all([readCollection("products"), readCollection("orders")]);
  const product = products.find((entry) => entry.id === productId);
  if (!product) throw new Error("That product is no longer available.");
  if (product.quantityAvailable < value.quantity) throw new Error("Requested quantity exceeds available inventory.");
  const shipping = estimateShipping({ shippingOption: value.shippingOption, postalCode: value.postalCode, quantity: value.quantity, unitType: product.unitType });
  const subtotalCents = product.priceCents * value.quantity;
  const order = {
    id: crypto.randomUUID(),
    buyerId: user.id,
    buyerName: user.name,
    company: value.company,
    email: value.email,
    items: [{ productId: product.id, slug: product.slug, title: product.title, quantity: value.quantity, unitPriceCents: product.priceCents, unitType: product.unitType }],
    shippingOption: value.shippingOption,
    shippingLabel: shipping.label,
    shippingEta: shipping.eta,
    shippingCents: shipping.amountCents,
    subtotalCents,
    totalCents: subtotalCents + shipping.amountCents,
    paymentMethod: value.paymentMethod,
    paymentStatus: "paid",
    shippingAddress: { contactName: value.contactName, company: value.company, address1: value.address1, city: value.city, state: value.state, postalCode: value.postalCode },
    createdAt: new Date().toISOString()
  };
  product.quantityAvailable -= value.quantity;
  product.updatedAt = new Date().toISOString();
  orders.unshift(order);
  await Promise.all([writeCollection("products", products), writeCollection("orders", orders)]);
  return order;
}

app.disable("x-powered-by");
app.set("view engine", "ejs");
app.set("views", path.join(process.cwd(), "views"));
app.locals.formatCurrency = formatCurrency;
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({ name: "nls.sid", secret: process.env.SESSION_SECRET || "nation-liquidation-stock-dev-secret", resave: false, saveUninitialized: false, proxy: true, cookie: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 1000 * 60 * 60 * 12 } }));
app.use(express.static(path.join(process.cwd(), "public")));
app.use((req, res, next) => { req.locale = pickLocale(req); const viewLocale = req.path.startsWith("/admin") ? "en" : req.locale; res.locals.locale = viewLocale; res.locals.t = (key) => t(viewLocale, key); next(); });
app.use((req, res, next) => { req.flash = (type, message, meta = {}) => { req.session.flashMessages = [...(req.session.flashMessages || []), { type, message, ...meta }]; }; res.locals.flashMessages = req.session.flashMessages || []; delete req.session.flashMessages; next(); });
app.use(wrap(async (req, res, next) => { if (!req.session.userId) { req.currentUser = null; res.locals.currentUser = null; return next(); } const users = await readCollection("users"); req.currentUser = users.find((user) => user.id === req.session.userId) || null; res.locals.currentUser = req.currentUser; next(); }));
app.use(wrap(async (req, res, next) => {
  res.locals.siteName = SITE_NAME;
  res.locals.categories = await getCategories();
  res.locals.conditions = CONDITIONS;
  res.locals.shippingOptions = SHIPPING_OPTIONS;
  res.locals.sortOptions = SORT_OPTIONS;
  res.locals.supportedLocales = LOCALES;
  res.locals.currentPath = req.path;
  res.locals.translateCategory = (value) => t(res.locals.locale, CATEGORY_LABEL_KEYS[value] || value);
  res.locals.translateCondition = (value) => t(res.locals.locale, CONDITION_LABEL_KEYS[value] || value);
  res.locals.translateUnit = (value) => t(res.locals.locale, UNIT_LABEL_KEYS[value] || value);
  res.locals.translateSort = (value) => t(res.locals.locale, SORT_LABEL_KEYS[value] || value);
  next();
}));
app.use((req, res, next) => { res.locals.whatsAppLink = createWhatsAppUrl("Hello Nation Liquidation Stock, I would like help with liquidation inventory."); next(); });

app.get("/", wrap(async (req, res) => {
  const [catalog, analytics] = await Promise.all([getCatalog({ sort: "featured" }), buildAnalytics()]);
  res.render("home", { title: t(req.locale, "page_title_home"), featuredProducts: catalog.filter((product) => product.featured).slice(0, 4), analytics });
}));
app.get("/products", wrap(async (req, res) => {
  const filters = { q: req.query.q || "", category: req.query.category || "", condition: req.query.condition || "", minPrice: req.query.minPrice || "", maxPrice: req.query.maxPrice || "", sort: req.query.sort || "featured" };
  res.render("products/index", { title: t(req.locale, "page_title_products"), filters, products: await getCatalog(filters) });
}));
app.get("/products/:slug", wrap(async (req, res) => {
  const product = await getProduct(req.params.slug);
  if (!product) return res.status(404).render("errors/404", { title: "Product not found" });
  let canReview = false; let isSaved = false;
  if (req.currentUser?.role === "buyer") {
    const [orders, reviews] = await Promise.all([readCollection("orders"), readCollection("reviews")]);
    canReview = orders.some((order) => order.buyerId === req.currentUser.id && order.items.some((item) => item.productId === product.id)) && !reviews.some((review) => review.buyerId === req.currentUser.id && review.productId === product.id);
    isSaved = req.currentUser.savedProductIds.includes(product.id);
  }
  const estimate = req.query.shippingOption || req.query.postalCode ? estimateShipping({ shippingOption: req.query.shippingOption, postalCode: req.query.postalCode, quantity: req.query.quantity || 1, unitType: product.unitType, locale: req.locale }) : null;
  res.render("products/show", { title: product.title, product, canReview, isSaved, estimate });
}));
app.post("/products/:id/save", requireAuth, wrap(async (req, res) => {
  if (req.currentUser.role !== "buyer") { req.flash("error", "Only buyers can save pallets."); return res.redirect(req.get("referer") || "/products"); }
  const saved = await toggleSavedProduct(req.currentUser.id, req.params.id);
  req.flash("success", saved ? "Pallet saved to your dashboard." : "Pallet removed from saved list.");
  res.redirect(req.get("referer") || "/dashboard");
}));
app.post("/products/:id/reviews", requireVerifiedBuyer, wrap(async (req, res) => {
  const parsed = validateReview(req.body);
  if (parsed.errors.length) { req.flash("error", parsed.errors.join(" ")); return res.redirect(req.get("referer") || "/products"); }
  await addReview(req.currentUser.id, req.params.id, parsed.value);
  req.flash("success", "Review submitted. Thank you for helping other buyers.");
  res.redirect(req.get("referer") || "/products");
}));
app.get("/register", (req, res) => res.render("auth/register", { title: t(req.locale, "page_title_register") }));
app.get("/login", (req, res) => res.render("auth/login", { title: t(req.locale, "page_title_login") }));
app.get("/forgot-password", (req, res) => res.render("auth/forgot-password", { title: t(req.locale, "page_title_forgot_password") }));
app.get("/reset-password", (req, res) => res.render("auth/reset-password", { title: t(req.locale, "page_title_reset_password"), token: req.query.token || "" }));
app.post("/register", wrap(async (req, res) => {
  const parsed = validateRegistration(req.body);
  if (parsed.errors.length) return res.status(422).render("auth/register", { title: "Create buyer account", errors: parsed.errors, form: req.body });
  try {
    const { user, token } = await createBuyer(parsed.value);
    req.session.userId = user.id;
    req.flash("success", "Account created. Verify your email to unlock checkout.", { link: `/verify-email?token=${token}`, linkText: "Verify now" });
    res.redirect("/dashboard");
  } catch (error) {
    res.status(422).render("auth/register", { title: "Create buyer account", errors: [error.message], form: req.body });
  }
}));
app.post("/login", wrap(async (req, res) => {
  const parsed = validateLogin(req.body);
  if (parsed.errors.length) return res.status(422).render("auth/login", { title: "Buyer login", errors: parsed.errors, form: req.body });
  const user = await authenticateUser(parsed.value.email, parsed.value.password);
  if (!user) return res.status(401).render("auth/login", { title: "Buyer login", errors: ["Invalid email or password."], form: req.body });
  req.session.userId = user.id;
  res.redirect(user.role === "admin" ? "/admin" : "/dashboard");
}));
app.post("/logout", (req, res) => req.session.destroy(() => res.redirect("/")));
app.get("/verify-email", wrap(async (req, res) => {
  const verified = await consumeVerification(sanitize(req.query.token, 160));
  req.flash(verified ? "success" : "error", verified ? "Email verified. You can now place orders." : "Verification link is invalid or expired.");
  res.redirect("/dashboard");
}));
app.post("/resend-verification", requireAuth, wrap(async (req, res) => {
  const token = await issueVerification(req.currentUser.id);
  req.flash("success", "Fresh verification link created.", { link: `/verify-email?token=${token}`, linkText: "Verify now" });
  res.redirect("/dashboard");
}));
app.post("/forgot-password", wrap(async (req, res) => {
  const token = await requestPasswordReset(sanitize(req.body.email, 160).toLowerCase());
  req.flash("success", token ? "Password reset link created for this demo account." : "If the account exists, a reset link is ready.", token ? { link: `/reset-password?token=${token}`, linkText: "Reset password" } : {});
  res.redirect("/login");
}));
app.post("/reset-password", wrap(async (req, res) => {
  const token = sanitize(req.body.token, 160);
  const password = String(req.body.password || "");
  const errors = [];
  if (!token) errors.push("Reset token is required.");
  if (password.length < 8) errors.push("Password must be at least 8 characters.");
  if (errors.length) return res.status(422).render("auth/reset-password", { title: "Choose a new password", token, errors });
  const updated = await applyPasswordReset(token, password);
  if (!updated) return res.status(422).render("auth/reset-password", { title: "Choose a new password", token, errors: ["Reset link is invalid or expired."] });
  req.flash("success", "Password updated. You can log in now.");
  res.redirect("/login");
}));
app.get("/dashboard", requireAuth, wrap(async (req, res) => {
  const [products, orders] = await Promise.all([readCollection("products"), readCollection("orders")]);
  const savedProducts = products.filter((product) => req.currentUser.savedProductIds.includes(product.id));
  const orderHistory = orders.filter((order) => order.buyerId === req.currentUser.id).sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
  res.render("dashboard/index", { title: t(req.locale, "page_title_dashboard"), savedProducts, orderHistory, verification: req.currentUser.emailVerified ? null : await latestVerificationFor(req.currentUser.id) });
}));
app.get("/checkout/:id", requireVerifiedBuyer, wrap(async (req, res) => {
  const product = await getProduct(req.params.id);
  if (!product) return res.status(404).render("errors/404", { title: "Product not found" });
  res.render("checkout/show", { title: t(req.locale, "page_title_checkout"), product, estimate: estimateShipping({ shippingOption: "freight", quantity: 1, unitType: product.unitType, locale: req.locale }), form: { quantity: 1, shippingOption: "freight", contactName: req.currentUser.name, company: req.currentUser.company, email: req.currentUser.email, address1: "", city: "", state: "", postalCode: "", paymentMethod: "mock_card" } });
}));
app.post("/checkout/:id", requireVerifiedBuyer, wrap(async (req, res) => {
  const product = await getProduct(req.params.id);
  if (!product) return res.status(404).render("errors/404", { title: "Product not found" });
  const parsed = validateCheckout(req.body);
  const estimate = estimateShipping({ shippingOption: parsed.value.shippingOption, postalCode: parsed.value.postalCode, quantity: parsed.value.quantity || 1, unitType: product.unitType, locale: req.locale });
  if (parsed.errors.length) return res.status(422).render("checkout/show", { title: "Checkout", product, estimate, form: req.body, errors: parsed.errors });
  const order = await checkoutProduct(req.currentUser, product.id, parsed.value);
  res.redirect(createWhatsAppUrl(buildOrderWhatsAppMessage(order)));
}));
app.get("/orders/:id", requireAuth, wrap(async (req, res) => {
  const orders = await readCollection("orders");
  const order = orders.find((entry) => entry.id === req.params.id);
  if (!order || (req.currentUser.role !== "admin" && order.buyerId !== req.currentUser.id)) return res.status(404).render("errors/404", { title: "Order not found" });
  res.render("orders/show", { title: `Order ${order.id.slice(0, 8)}`, order, whatsAppOrderLink: createWhatsAppUrl(buildOrderWhatsAppMessage(order)) });
}));
app.post("/inquiries", wrap(async (req, res) => {
  const parsed = validateInquiry(req.body);
  if (parsed.errors.length) { req.flash("error", parsed.errors.join(" ")); return res.redirect(req.get("referer") || "/"); }
  const inquiry = await addInquiry(parsed.value);
  res.redirect(createWhatsAppUrl(buildInquiryWhatsAppMessage(inquiry)));
}));
app.get("/set-language/:locale", (req, res) => { if (LOCALES.some((entry) => entry.value === req.params.locale)) req.session.locale = req.params.locale; res.redirect(req.get("referer") || "/"); });
app.get("/admin", requireAdmin, wrap(async (req, res) => {
  const [analytics, products, orders, inquiries] = await Promise.all([buildAnalytics(), getCatalog({ sort: "featured" }), readCollection("orders"), readCollection("inquiries")]);
  res.render("admin/dashboard", { title: "Admin dashboard", analytics, products, orders: orders.slice(0, 8), inquiries: inquiries.slice(0, 8) });
}));
app.get("/admin/products/new", requireAdmin, (req, res) => res.render("admin/product-form", { title: "Add inventory", product: { title: "", description: "", category: (res.locals.categories[0] || DEFAULT_CATEGORIES[0]), condition: CONDITIONS[0], unitType: "pallet", quantityAvailable: 1, images: [], manifest: [], featured: false, priceCents: 0 }, formAction: "/admin/products", submitLabel: "Create product" }));
const productUpload = upload.fields([{ name: "imageFiles", maxCount: 4 }, { name: "imageFiles[]", maxCount: 4 }]);
app.post("/admin/products", requireAdmin, productUpload, wrap(async (req, res) => {
  const result = await saveProductRecord(null, req.body, normalizeUploadedFiles(req.files));
  if (result.errors.length) return res.status(422).render("admin/product-form", { title: "Add inventory", errors: result.errors, product: { ...req.body, images: [] }, formAction: "/admin/products", submitLabel: "Create product" });
  req.flash("success", "Product added to the catalog.");
  res.redirect("/admin");
}));
app.get("/admin/products/:id/edit", requireAdmin, wrap(async (req, res) => {
  const product = await getProduct(req.params.id);
  if (!product) return res.status(404).render("errors/404", { title: "Product not found" });
  res.render("admin/product-form", { title: `Edit ${product.title}`, product, formAction: `/admin/products/${product.id}`, submitLabel: "Save changes" });
}));
app.post("/admin/products/:id", requireAdmin, productUpload, wrap(async (req, res) => {
  const existing = await getProduct(req.params.id);
  if (!existing) return res.status(404).render("errors/404", { title: "Product not found" });
  const result = await saveProductRecord(req.params.id, req.body, normalizeUploadedFiles(req.files), existing);
  if (result.errors.length) return res.status(422).render("admin/product-form", { title: `Edit ${existing.title}`, errors: result.errors, product: { ...existing, ...req.body, images: existing.images }, formAction: `/admin/products/${existing.id}`, submitLabel: "Save changes" });
  req.flash("success", "Product updated.");
  res.redirect("/admin");
}));
app.post("/admin/products/:id/delete", requireAdmin, wrap(async (req, res) => { await removeProduct(req.params.id); req.flash("success", "Product removed from the catalog."); res.redirect("/admin"); }));
app.post("/admin/categories", requireAdmin, wrap(async (req, res) => {
  try {
    await createCategory(req.body.name);
    req.flash("success", "Category added.");
  } catch (error) {
    req.flash("error", error.message);
  }
  res.redirect("/admin");
}));
app.post("/admin/categories/update", requireAdmin, wrap(async (req, res) => {
  try {
    await updateCategory(req.body.currentName, req.body.nextName);
    req.flash("success", "Category updated.");
  } catch (error) {
    req.flash("error", error.message);
  }
  res.redirect("/admin");
}));
app.post("/admin/categories/delete", requireAdmin, wrap(async (req, res) => {
  try {
    await deleteCategory(req.body.name);
    req.flash("success", "Category deleted.");
  } catch (error) {
    req.flash("error", error.message);
  }
  res.redirect("/admin");
}));
app.get("/api/products", wrap(async (req, res) => res.json({ products: await getCatalog(req.query) })));
app.get("/api/products/:id", wrap(async (req, res) => { const product = await getProduct(req.params.id); if (!product) return res.status(404).json({ error: "Product not found" }); res.json({ product }); }));
app.get("/api/shipping-estimate", (req, res) => res.json({ estimate: estimateShipping({ ...req.query, locale: req.locale }) }));
app.post("/api/checkout/:id", requireVerifiedBuyer, wrap(async (req, res) => { const parsed = validateCheckout(req.body); if (parsed.errors.length) return res.status(422).json({ errors: parsed.errors }); res.status(201).json({ order: await checkoutProduct(req.currentUser, req.params.id, parsed.value) }); }));
app.get("/api/admin/analytics", requireAdmin, wrap(async (req, res) => res.json({ analytics: await buildAnalytics() })));
app.post("/api/admin/products", requireAdmin, wrap(async (req, res) => { const result = await saveProductRecord(null, req.body, []); if (result.errors.length) return res.status(422).json({ errors: result.errors }); res.status(201).json({ product: result.product }); }));
app.put("/api/admin/products/:id", requireAdmin, wrap(async (req, res) => { const existing = await getProduct(req.params.id); if (!existing) return res.status(404).json({ error: "Product not found" }); const result = await saveProductRecord(req.params.id, req.body, [], existing); if (result.errors.length) return res.status(422).json({ errors: result.errors }); res.json({ product: result.product }); }));
app.delete("/api/admin/products/:id", requireAdmin, wrap(async (req, res) => { await removeProduct(req.params.id); res.status(204).send(); }));
app.use((req, res) => res.status(404).render("errors/404", { title: t(req.locale, "page_title_not_found") }));
app.use((error, req, res, next) => { console.error(error); if (res.headersSent) return next(error); if (error instanceof multer.MulterError || error?.http_code === 400 || /Image upload failed|Empty file|Unexpected field/i.test(String(error?.message || ""))) { req.flash("error", error.message || "Image upload failed. Please try a smaller image."); return res.redirect(req.get("referer") || "/admin"); } res.status(500).render("errors/500", { title: t(req.locale, "page_title_server_error") }); });
async function createApp() { await initializeStore(); return app; }
module.exports = { createApp };






















