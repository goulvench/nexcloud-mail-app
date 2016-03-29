/**
 * ownCloud - require('app')
 *
 * This file is licensed under the Affero General Public License version 3 or
 * later. See the COPYING file.
 *
 * @author Christoph Wurst <christoph@winzerhof-wurst.at>
 * @copyright Christoph Wurst 2016
 */

define(function(require) {
	'use strict';

	var Marionette = require('marionette');
	var Handlebars = require('handlebars');
	var $ = require('jquery');
	var OC = require('OC');
	var Radio = require('radio');
	var Attachments = require('models/attachments');
	var AttachmentsView = require('views/attachments');
	var ComposerTemplate = require('text!templates/composer.html');

	return Marionette.LayoutView.extend({
		type: 'new',
		attachments: null,
		submitCallback: null,
		sentCallback: null,
		draftCallback: null,
		accounts: null,
		account: null,
		folderId: null,
		messageId: null,
		draftInterval: 1500,
		draftTimer: null,
		draftUID: null,
		hasData: false,
		autosized: false,
		events: {
			'click .submit-message': 'submitMessage',
			'click .submit-message-wrapper-inside': 'submitMessageWrapperInside',
			'keypress .message-body': 'handleKeyPress',
			'input  .to': 'onInputChanged',
			'paste  .to': 'onInputChanged',
			'keyup  .to': 'onInputChanged',
			'input  .cc': 'onInputChanged',
			'paste  .cc': 'onInputChanged',
			'keyup  .cc': 'onInputChanged',
			'input  .bcc': 'onInputChanged',
			'paste  .bcc': 'onInputChanged',
			'keyup  .bcc': 'onInputChanged',
			'input  .subject': 'onInputChanged',
			'paste  .subject': 'onInputChanged',
			'keyup  .subject': 'onInputChanged',
			'input  .message-body': 'onInputChanged',
			'paste  .message-body': 'onInputChanged',
			'keyup  .message-body': 'onInputChanged',
			'focus  .recipient-autocomplete': 'onAutoComplete',
			// CC/BCC toggle
			'click .composer-cc-bcc-toggle': 'ccBccToggle'
		},
		initialize: function(options) {
			var defaultOptions = {
				type: 'new',
				onSubmit: function() {
				},
				onDraft: function() {
				},
				onSent: function() {
				},
				account: null,
				folderId: null,
				messageId: null
			};
			_.defaults(options, defaultOptions);

			/**
			 * Composer type (new, reply)
			 */
			this.type = options.type;

			/**
			 * Containing element
			 */
			if (options.el) {
				this.el = options.el;
			}

			/**
			 * Callback functions
			 */
			this.submitCallback = options.onSubmit;
			this.draftCallback = options.onDraft;
			this.sentCallback = options.onSent;

			/**
			 * Attachments sub-view
			 */
			this.attachments = new Attachments();

			if (!this.isReply()) {
				this.accounts = options.accounts;
				this.account = options.account || this.accounts.at(0);
			} else {
				this.account = options.account;
				this.folderId = options.folderId;
				this.messageId = options.messageId;
			}
		},
		render: function(options) {
			options = options || {};
			var defaultOptions = {
				data: {
					to: '',
					cc: '',
					subject: '',
					body: ''
				}
			};
			_.defaults(options, defaultOptions);

			var template = Handlebars.compile(ComposerTemplate);

			this.attachments.reset();

			var accounts = null;
			if (this.accounts) {
				accounts = this.accounts.map(function(account) {
					return account.toJSON();
				});
				accounts = _.filter(accounts, function(account) {
					return account.accountId !== -1;
				});
			}

			// Render handlebars template
			var html = template({
				aliases: accounts,
				isReply: this.isReply(),
				to: options.data.to,
				cc: options.data.cc,
				subject: options.data.subject,
				message: options.data.body,
				submitButtonTitle: this.isReply() ? t('mail', 'Reply') : t('mail', 'Send'),
				// Reply data
				replyToList: options.data.replyToList,
				replyCc: options.data.replyCc,
				replyCcList: options.data.replyCcList
			});

			$('.tipsy-mailto').tipsy({gravity: 'n', live: true});

			this.$el.html(html);

			var view = new AttachmentsView({
				el: $('.new-message-attachments'),
				collection: this.attachments
			});

			// And render it
			view.render();

			if (this.isReply()) {
				// Expand reply message body on click
				var _this = this;
				this.$('.message-body').click(function() {
					_this.setAutoSize(true);
				});
			} else {
				this.setAutoSize(true);
			}

			return this;
		},
		setAutoSize: function(state) {
			if (state === true) {
				if (!this.autosized) {
					this.$('textarea').autosize({append: '\n\n'});
					this.autosized = true;
				}
				this.$('.message-body').trigger('autosize.resize');
			} else {
				this.$('.message-body').trigger('autosize.destroy');

				// dirty workaround to set reply message body to the default size
				this.$('.message-body').css('height', '');
				this.autosized = false;
			}
		},
		isReply: function() {
			return this.type === 'reply';
		},
		onInputChanged: function() {
			// Submit button state
			var to = this.$('.to').val();
			var subject = this.$('.subject').val();
			var body = this.$('.message-body').val();
			if (to !== '' || subject !== '' || body !== '') {
				this.$('.submit-message').removeAttr('disabled');
			} else {
				this.$('.submit-message').attr('disabled', true);
			}

			// Save draft
			this.hasData = true;
			clearTimeout(this.draftTimer);
			var _this = this;
			this.draftTimer = setTimeout(function() {
				_this.saveDraft();
			}, this.draftInterval);
		},
		handleKeyPress: function(event) {
			// Define which objects to check for the event properties.
			// (Window object provides fallback for IE8 and lower.)
			event = event || window.event;
			var key = event.keyCode || event.which;
			// If enter and control keys are pressed:
			// (Key 13 and 10 set for compatibility across different operating systems.)
			if ((key === 13 || key === 10) && event.ctrlKey) {
				// If the new message is completely filled, and ready to be sent:
				// Send the new message.
				var sendBtnState = this.$('.submit-message').attr('disabled');
				if (sendBtnState === undefined) {
					this.submitMessage();
				}
			}
			return true;
		},
		ccBccToggle: function() {
			this.$('.composer-cc-bcc').slideToggle();
			this.$('.composer-cc-bcc .cc').focus();
			this.$('.composer-cc-bcc-toggle').fadeOut();
		},
		getMessage: function() {
			var message = {};
			var newMessageBody = this.$('.message-body');
			var to = this.$('.to');
			var cc = this.$('.cc');
			var bcc = this.$('.bcc');
			var subject = this.$('.subject');

			message.body = newMessageBody.val();
			message.to = to.val();
			message.cc = cc.val();
			message.bcc = bcc.val();
			message.subject = subject.val();
			message.attachments = this.attachments.toJSON();

			return message;
		},
		submitMessageWrapperInside: function() {
			// http://stackoverflow.com/questions/487073/check-if-element-is-visible-after-scrolling
			if (this._isVisible()) {
				this.$('.submit-message').click();
			} else {
				$('#mail-message').animate({
					scrollTop: this.$el.offset().top
				}, 1000);
				this.$('.submit-message-wrapper-inside').hide();
				// This function is needed because $('.message-body').focus does not focus the first line
				this._setCaretToPos(this.$('.message-body')[0], 0);
			}
		},
		_setSelectionRange: function(input, selectionStart, selectionEnd) {
			if (input.setSelectionRange) {
				input.focus();
				input.setSelectionRange(selectionStart, selectionEnd);
			} else if (input.createTextRange) {
				var range = input.createTextRange();
				range.collapse(true);
				range.moveEnd('character', selectionEnd);
				range.moveStart('character', selectionStart);
				range.select();
			}
		},
		_setCaretToPos: function(input, pos) {
			this._setSelectionRange(input, pos, pos);
		},
		_isVisible: function() {
			var $elem = this.$el;
			var $window = $(window);
			var docViewTop = $window.scrollTop();
			var docViewBottom = docViewTop + $window.height();
			var elemTop = $elem.offset().top;

			return elemTop <= docViewBottom;
		},
		submitMessage: function() {
			clearTimeout(this.draftTimer);
			//
			// TODO:
			//  - input validation
			//  - feedback on success
			//  - undo lie - very important
			//

			// loading feedback: show spinner and disable elements
			var newMessageBody = this.$('.message-body');
			var newMessageSend = this.$('.submit-message');
			newMessageBody.addClass('icon-loading');
			var to = this.$('.to');
			var cc = this.$('.cc');
			var bcc = this.$('.bcc');
			var subject = this.$('.subject');
			this.$('.mail-account').prop('disabled', true);
			to.prop('disabled', true);
			cc.prop('disabled', true);
			bcc.prop('disabled', true);
			subject.prop('disabled', true);
			this.$('.new-message-attachments-action').css('display', 'none');
			this.$('#mail_new_attachment').prop('disabled', true);
			newMessageBody.prop('disabled', true);
			newMessageSend.prop('disabled', true);
			newMessageSend.val(t('mail', 'Sending …'));

			// if available get account from drop-down list
			if (this.$('.mail-account').length > 0) {
				this.account = this.accounts.get(this.$('.mail-account').
					find(':selected').val());
			}

			// send the mail
			var _this = this;
			var options = {
				draftUID: this.draftUID,
				success: function() {
					OC.Notification.showTemporary(t('mail', 'Message sent!'));

					// close composer
					if (_this.sentCallback !== null) {
						_this.sentCallback();
					} else {
						_this.$('.message-composer').slideUp();
					}
					_this.$('#mail_new_message').prop('disabled', false);
					to.val('');
					cc.val('');
					bcc.val('');
					subject.val('');
					newMessageBody.val('');
					newMessageBody.trigger('autosize.resize');
					_this.attachments.reset();
					if (_this.draftUID !== null) {
						// the sent message was a draft
						if (!_.isUndefined(Radio.ui.request('messagesview:collection'))) {
							Radio.ui.request('messagesview:collection').
								remove({id: _this.draftUID});
						}
						_this.draftUID = null;
					}
				},
				error: function(jqXHR) {
					var error = '';
					if (jqXHR.status === 500) {
						error = t('mail', 'Server error');
					} else {
						var resp = JSON.parse(jqXHR.responseText);
						error = resp.message;
					}
					newMessageSend.prop('disabled', false);
					OC.Notification.showTemporary(error);
				},
				complete: function() {
					// remove loading feedback
					newMessageBody.removeClass('icon-loading');
					_this.$('.mail-account').prop('disabled', false);
					to.prop('disabled', false);
					cc.prop('disabled', false);
					bcc.prop('disabled', false);
					subject.prop('disabled', false);
					_this.$('.new-message-attachments-action').
						css('display', 'inline-block');
					_this.$('#mail_new_attachment').prop('disabled', false);
					newMessageBody.prop('disabled', false);
					newMessageSend.prop('disabled', false);
					newMessageSend.val(t('mail', 'Send'));
				}
			};

			if (this.isReply()) {
				options.messageId = this.messageId;
				options.folder = this.account.get('folders').get(this.folderId);
			}

			this.submitCallback(this.account, this.getMessage(), options);
			return false;
		},
		saveDraft: function(onSuccess) {
			clearTimeout(this.draftTimer);
			//
			// TODO:
			//  - input validation
			//  - feedback on success
			//  - undo lie - very important
			//

			// if available get account from drop-down list
			if (this.$('.mail-account').length > 0) {
				this.account = this.accounts.get(this.$('.mail-account').
					find(':selected').val());
			}

			// send the mail
			var _this = this;
			this.draftCallback(this.account, this.getMessage(), {
				folder: this.account.get('folders').get(this.folderId),
				messageId: this.messageId,
				draftUID: this.draftUID,
				success: function(data) {
					if (_.isFunction(onSuccess)) {
						onSuccess();
					}
					_this.draftUID = data.uid;
				},
				error: function() {
					// TODO: show error
				}
			});
			return false;
		},
		setReplyBody: function(from, date, text) {
			var minutes = date.getMinutes();

			this.$('.message-body').first().text(
				'\n\n\n' +
				from + ' – ' +
				$.datepicker.formatDate('D, d. MM yy ', date) +
				date.getHours() + ':' + (minutes < 10 ? '0' : '') + minutes + '\n> ' +
				text.replace(/\n/g, '\n> ')
				);

			this.setAutoSize(false);
			// Expand reply message body on click
			var _this = this;
			this.$('.message-body').click(function() {
				_this.setAutoSize(true);
			});
		},
		focusTo: function() {
			this.$el.find('input.to').focus();
		},
		setTo: function(value) {
			this.$el.find('input.to').val(value);
		},
		focusSubject: function() {
			this.$el.find('input.subject').focus();
		},
		autoComplete: function() {
			function split(val) {
				return val.split(/,\s*/);
			}

			function extractLast(term) {
				return split(term).pop();
			}
			if (!$(this).
				data('autocomplete')) { // If the autocomplete wasn't called yet:
				// don't navigate away from the field on tab when selecting an item
				$(this).bind('keydown', function(event) {
					if (event.keyCode === $.ui.keyCode.TAB &&
						typeof $(this).data('autocomplete') !== 'undefined' &&
						$(this).data('autocomplete').menu.active) {
						event.preventDefault();
					}
				}).autocomplete({
					source: function(request, response) {
						$.getJSON(
							OC.generateUrl('/apps/mail/autoComplete'),
							{
								term: extractLast(request.term)
							}, response);
					},
					search: function() {
						// custom minLength
						var term = extractLast(this.value);
						return term.length >= 2;

					},
					focus: function() {
						// prevent value inserted on focus
						return false;
					},
					select: function(event, ui) {
						var terms = split(this.value);
						// remove the current input
						terms.pop();
						// add the selected item
						terms.push(ui.item.value);
						// add placeholder to get the comma-and-space at the end
						terms.push('');
						this.value = terms.join(', ');
						return false;
					}
				});
			}
		}
	});

});
