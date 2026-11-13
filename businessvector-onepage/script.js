/* БизнесВектор — одностраничный сайт. Меню, подсветка раздела, демонстрационная форма. */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* ---------- Мобильное меню ---------- */
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('site-nav');

  function closeMenu() {
    nav.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
  }

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    // После перехода по пункту меню закрываем его
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        closeMenu();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        closeMenu();
        toggle.focus();
      }
    });
  }

  /* ---------- Подсветка текущего раздела в меню ---------- */
  var navLinks = nav ? Array.prototype.slice.call(nav.querySelectorAll('a[href^="#"]')) : [];
  var sections = navLinks
    .map(function (link) {
      return document.getElementById(link.getAttribute('href').slice(1));
    })
    .filter(Boolean);

  function setActive(id) {
    navLinks.forEach(function (link) {
      var isActive = link.getAttribute('href') === '#' + id;
      link.classList.toggle('is-active', isActive);
    });
  }

  if ('IntersectionObserver' in window && sections.length) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            setActive(entry.target.id);
          }
        });
      },
      { rootMargin: '-45% 0px -50% 0px' }
    );
    sections.forEach(function (section) {
      observer.observe(section);
    });
  }

  /* ---------- Демонстрационная форма ---------- */
  var form = document.getElementById('contact-form');
  var status = document.getElementById('form-status');

  var rules = {
    name: function (value) {
      return value ? '' : 'Укажите имя.';
    },
    email: function (value) {
      if (!value) {
        return 'Укажите электронную почту.';
      }
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? '' : 'Проверьте адрес: он должен быть вида name@example.ru.';
    },
    message: function (value) {
      return value ? '' : 'Опишите задачу хотя бы в двух словах.';
    }
  };

  function validateField(field) {
    var message = rules[field.name](field.value.trim());
    var errorBox = document.getElementById(field.name + '-error');
    errorBox.textContent = message;
    if (message) {
      field.setAttribute('aria-invalid', 'true');
    } else {
      field.removeAttribute('aria-invalid');
    }
    return !message;
  }

  if (form && status) {
    var fields = Object.keys(rules).map(function (name) {
      return form.elements[name];
    });

    fields.forEach(function (field) {
      field.addEventListener('input', function () {
        if (field.hasAttribute('aria-invalid')) {
          validateField(field);
        }
        status.hidden = true;
      });
    });

    form.addEventListener('submit', function (event) {
      // Форма демонстрационная: ничего никуда не отправляем
      event.preventDefault();

      var firstInvalid = null;
      fields.forEach(function (field) {
        if (!validateField(field) && !firstInvalid) {
          firstInvalid = field;
        }
      });

      if (firstInvalid) {
        status.hidden = true;
        firstInvalid.focus();
        return;
      }

      status.textContent = 'Демонстрационная форма — данные не отправляются. Поля заполнены верно, но сообщение никуда не передано.';
      status.hidden = false;
    });
  }
})();
