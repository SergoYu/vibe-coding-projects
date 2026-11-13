/* БизнесВектор — многостраничный сайт. Общий скрипт: мобильное меню и демонстрационная форма. */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  /* ---------- Мобильное меню ---------- */
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('site-nav');

  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var isOpen = nav.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        nav.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.focus();
      }
    });
  }

  /* ---------- Демонстрационная форма (есть только на странице «Контакты») ---------- */
  var form = document.getElementById('contact-form');
  var status = document.getElementById('form-status');

  if (!form || !status) {
    return;
  }

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
    document.getElementById(field.name + '-error').textContent = message;
    if (message) {
      field.setAttribute('aria-invalid', 'true');
    } else {
      field.removeAttribute('aria-invalid');
    }
    return !message;
  }

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
})();
