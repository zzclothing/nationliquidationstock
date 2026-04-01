document.addEventListener("DOMContentLoaded", () => {
  const targets = document.querySelectorAll(
    ".hero-section h1, .hero-copy, .hero-actions, .section-heading, .card, .product-card, .site-footer, .table-wrap, .flash"
  );

  targets.forEach((element, index) => {
    element.classList.add("reveal");
    element.style.setProperty("--delay", `${Math.min(index * 55, 500)}ms`);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("reveal-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  targets.forEach((element) => observer.observe(element));

  const header = document.querySelector(".site-header");
  if (header) {
    window.addEventListener("scroll", () => {
      header.classList.toggle("site-header-scrolled", window.scrollY > 10);
    });
  }

  const float = document.querySelector(".whatsapp-float");
  if (float) {
    window.addEventListener("scroll", () => {
      float.classList.toggle("whatsapp-float-compact", window.scrollY > 120);
    });
  }
});

(function () {
  const input = document.getElementById("admin-image-files") || document.querySelector('input[name="imageFiles"]');
  if (!input) return;

  let preview = document.getElementById("admin-upload-preview");
  if (!preview) {
    preview = document.createElement("div");
    preview.id = "admin-upload-preview";
    preview.className = "thumb-grid";
    input.insertAdjacentElement("afterend", preview);
  }

  input.addEventListener("change", () => {
    preview.innerHTML = "";
    Array.from(input.files || []).forEach((file) => {
      if (!file.type.startsWith("image/")) return;
      const img = document.createElement("img");
      img.alt = file.name;
      img.src = URL.createObjectURL(file);
      preview.appendChild(img);
    });
  });
})();
