
/*
 * aciTree jQuery Plugin v3.0.0-rc.5
 * http://acoderinsights.ro
 *
 * Copyright (c) 2013 Dragos Ursu
 * Dual licensed under the MIT or GPL Version 2 licenses.
 *
 * Require jQuery Library >= v1.7.1 http://jquery.com
 * + aciPlugin >= v1.1.1 https://github.com/dragosu/jquery-aciPlugin
 *
 * Date: Apr Mon 15 20:10 2013 +0200
 */

/*
 * The aciTree core.
 *
 * A few words about how a item data looks like:
 *
 * for a 'file' item (a item that does not have any childrens):
 *
 * {
 *   id: 'some_file_ID',                // unique item ID
 *   label: 'This is a File Item',      // the item label (text value)
 *   isFolder: false,                   // FALSE means it's a 'file' item
 *   icon: 'fileIcon',                  // CSS class name for the icon (if any), can also be a Array ['CSS class name', background-position-x, background-position-y]
 *   random_prop: 'random 1'            // just a random property (you can have any number defined)
 * }
 *
 * for a 'folder' item (a item that have at least a children under it):
 *
 * {
 *   id: 'some_folder_ID',              // unique item ID
 *   label: 'This is a Folder Item',    // the item label (text value)
 *   isFolder: true,                    // can also be NULL meaning not sure if there are any childrens (on load will be transformed in a 'file' if there aren't any childrens)
 *   open: false,                       // if TRUE then the node will be opened when the tree is loaded
 *   icon: 'folderIcon',                // CSS class name for the icon (if any), can also be a Array ['CSS class name', background-position-x, background-position-y]
 *   random_prop: 'random 2',           // just a random property (you can have any number defined)
 *   childs: [{ ... item data ... }, { ... item data ... }, ...]
 * }
 *
 * The 'childs' array can be empty, in this case the childrens will be loaded when the node will be opened for the first time.
 *
 * Please note that the item data should be valid data (in the expected format). No checking is done and errors can appear on invalid data.
 *
 * One note about a item: a item is always the LI element with the class 'aciTreeLi'.
 * The childrens of a node are all added under a UL element with the class 'aciTreeUl'.
 *
 * All API functions expect only one item. If you need to process more at once then you'll need to loop between all of them yourself.
 *
 * The 'options' parameter for all API methods (when there is one) it's a object with the properties (not all are required or used):
 *
 * {
 *   uid: string -> operation UID (defaults to 'ui')
 *   success: function (item, options, data) -> callback to be called on success (you can access plugin API with 'this' keyword inside the callback)
 *   fail: function (item, options, data) -> callback to be called on fail (you can access plugin API with 'this' keyword inside the callback)
 *   notify: function (item, options, data) -> notify callback (internal use for when already in the requested state, will call 'success' by default)
 *   expand: true/false -> propagate on open/toggle
 *   collapse: true/false -> propagate on close/toggle
 *   unique: true/false -> close other branches (on open/toggle)?
 *   unanimated: true/false -> if it's TRUE then no animations are to be run (used on open/close/toggle)
 *   itemData: object[item data]/array[item data] -> used when adding/updating items
 * }
 *
 * Note: when using the API methods that support the 'options' parameter, you will need to use the success/fail callbacks if you need to do
 * any processing after the API call. This because there can be async operations that will complete at a later time and the API methods will
 * exit before the job is actually completed. This will happen when items are loaded with AJAX, on animations and other delayed operations (see _queue).
 *
 */

(function($){

    // default options

    var options = {
        jsonUrl: null,                  // URL to the JSON provider, something like 'path/script?branch=' (will add the node ID value on load)
        rootData: null,                 // initial ROOT data for the Tree (if NULL then one initial AJAX request is made on init)
        threads: 4,                     // how many AJAX load requests will be run in the same time?
        queueDelay: 40,                 // a small delay for our queue implementation (less = uses more CPU, more = slower tree processing)
        loaderDelay: 500,               // how many msec to wait before showing the main loader? (on lengthy operations)
        expand: false,                  // if TRUE then all childrens of a node are expanded when the node is opened
        collapse: false,                // if TRUE then all childrens of a node are collapsed when the node is closed
        unique: false,                  // if TRUE then a single tree branch will stay open, the oters are closed when a node is opened
        empty: false,                   // if TRUE then all childrens of a node are removed when the node is closed
        show: {                         // show node/ROOT animation (default is slideDown)
            props: {
                'height': 'show'
            },
            duration: 'medium',
            easing: 'linear'
        },
        animateRoot: true,              // if the ROOT should be animated on init
        hide: {                         // hide node animation (default is slideUp)
            props: {
                'height': 'hide'
            },
            duration: 'medium',
            easing: 'linear'
        },
        view: {                         // scroll item into view animation
            duration: 'medium',
            easing: 'linear'
        },
        callbacks: {
            // item : function(parent, item, itemData, level)
            // you can access plugin API with 'this' keyword inside the callback
            item: null                  // called when a new item is created but before it is inserted in the DOM
        }
    };

    // aciTree plugin core

    var aciTree_core = {

        __extend: function(){
            // add extra data
            $.extend(this._instance, {
                locked: false
            });
            $.extend(this._private, {
                loadQueue: new this._queue(this._instance.options.threads, false, this._instance.options.queueDelay).context(this),
                // timeouts for the loader
                loaderHide: null,
                loaderInterval: null,
                // busy delay count
                delayBusy: 0
            });
        },

        init: function(options){
            var _this = this;
            options = this._options(options);
            if (this.wasInit()){
                this._trigger(null, 'wasinit', options);
                this._fail(null, options);
                return;
            }
            if (this.isLocked()){
                this._trigger(null, 'locked', options);
                this._fail(null, options);
                return;
            }
            if (!this._trigger(null, 'beforeinit', options)){
                this._trigger(null, 'initfail', options);
                this._fail(null, options);
                return;
            }
            this._instance.locked = true;
            this._instance.jQuery.bind('mousedown' + this._instance.nameSpace, function(e){
                var element = $(e.target);
                if (element.is('.aciTreeButton,.aciTreeLoad,.aciTreeEntry,.aciTreeIcon')){
                    _this._instance.jQuery.focus();
                    // prevent selection
                    e.preventDefault();
                }
            }).on('click' + this._instance.nameSpace, '.aciTreeButton', function(e){
                var item = _this.itemFrom(e.target);
                // skip when busy
                if (!_this.isBusy(item)){
                    _this.toggle(item, {
                        collapse: _this._instance.options.collapse,
                        expand: _this._instance.options.expand,
                        unique: _this._instance.options.unique
                    });
                }
            }).on('mouseenter' + this._instance.nameSpace + ' mouseleave' + this._instance.nameSpace, '.aciTreeButton', function(e){
                var element = $(e.target);
                if (!element.hasClass('aciTreeButton')){
                    element = element.parents('.aciTreeButton:first');
                }
                element.toggleClass('aciTreeHover', e.type == 'mouseenter');
            }).on('mouseenter' + this._instance.nameSpace + ' mouseleave' + this._instance.nameSpace, '.aciTreeLine', function(e){
                var element = $(e.target);
                if (!element.hasClass('aciTreeLine')){
                    element = element.parents('.aciTreeLine:first');
                }
                element.toggleClass('aciTreeHover', e.type == 'mouseenter');
            });
            this._initHook();
            // we keep the _super reference
            var _super = this._super;
            var success = function(){
                // call the parent
                _super.apply(this);
                this._instance.locked = false;
                this._trigger(null, 'init', options);
                this._success(null, options);
            };
            var fail = function(){
                // call the parent
                _super.apply(this);
                this._instance.locked = false;
                this._trigger(null, 'initfail', options);
                this._fail(null, options);
            };
            if (this._instance.options.rootData){
                this.loadFrom(null, this._inner(options, {
                    success: success,
                    fail: fail,
                    itemData: this._instance.options.rootData
                }));
            } else if (this._instance.options.jsonUrl){
                this.ajaxLoad(null, this._inner(options, {
                    success: success,
                    fail: fail
                }));
            } else {
                success.apply(this);
            }
        },

        _initHook: function(){
        // override this to do extra init
        },

        // check locked state
        isLocked: function(){
            return this._instance.locked;
        },

        // a small queue implementation
        _queue: function(threads, realtime, delay){
            var fifo = [];
            var finalize = [];
            var workers = threads ? Math.max(threads, 1) : 1;
            var load = 0;
            var locked = false;
            var apply = null;
            // push a 'callback' for later call
            this.push = function(callback, async){
                if (!locked){
                    fifo.push({
                        callback: callback,
                        async: async
                    });
                }
                return this;
            };
            // push a 'callback' for later call (on completion)
            this.complete = function (callback, async){
                if (!locked){
                    finalize.push({
                        callback: callback,
                        async: async
                    });
                }
                return this;
            };
            // destroy queue
            this.destroy = function(){
                locked = true;
                setTimeout(function(){
                    finalize = [];
                    fifo = [];
                    load = 0;
                    locked = false;
                }, delay);
            };
            // return TRUE if all threads are busy
            this.busy = function(){
                return load >= workers;
            };
            // return TRUE if it's empty
            this.empty = function(){
                return (load == 0) && (fifo.length == 0) && (finalize.length == 0);
            };
            this.context = function(context){
                apply = context;
                return this;
            },
            // do the magic: run our queue
            this.run = function(spawn){
                if ((load >= workers) || locked){
                    return;
                }
                if (spawn){
                    for(var i = 1, size = workers - load; i < size; i++){
                        this.run();
                    }
                }
                var _self = this;
                setTimeout(function(){
                    if ((load >= workers) || locked){
                        return;
                    }
                    var item = fifo.shift();
                    if (!item){
                        if (fifo.length){
                            setTimeout(function(){
                                _self.run();
                            }, 10);
                        } else {
                            item = finalize.shift();
                        }
                    }
                    if (item){
                        if (item.async){
                            load++;
                            if (apply){
                                item.callback.call(apply, function(){
                                    load--;
                                    _self.run();
                                });
                            } else {
                                item.callback(function(){
                                    load--;
                                    _self.run();
                                });
                            }
                        } else {
                            load++;
                            if (apply){
                                item.callback.apply(apply);
                            } else {
                                item.callback();
                            }
                            load--;
                            _self.run();
                        }
                    }
                }, realtime ? 5 : delay);
            };
        },

        // options object (need to be in this form for all API functions
        // that have a 'options' parameter, not all properties are required)
        _options: function(object, success, fail, notify){
            var options = $.extend({
                uid: 'ui',
                success: null, // success callback
                fail: null, // fail callback
                notify: null, // notify callback (internal use for when already in the requested state)
                expand: this._instance.options.expand, // propagate (on open)
                collapse: this._instance.options.collapse, // propagate (on close)
                unique: this._instance.options.unique, // keep a single branch open (on open)
                unanimated: this._instance.options.unanimated, // unanimated (open/close/toggle)
                itemData: {} // item data (init[Array], append[Array/object], after/before[Array/object])
            }, object);
            if (success){
                if (object && object.success) {
                    options.success = function(){
                        success.apply(this, arguments);
                        object.success.apply(this, arguments);
                    };
                } else {
                    options.success = success;
                }
            }
            if (fail){
                if (object && object.fail) {
                    options.fail = function(){
                        fail.apply(this, arguments);
                        object.fail.apply(this, arguments);
                    };
                } else {
                    options.fail = fail;
                }
            }
            if (notify){
                if (object && object.notify) {
                    options.notify = function(){
                        notify.apply(this, arguments);
                        object.notify.apply(this, arguments);
                    };
                } else {
                    if (!options.notify && object && object.success) {
                        options.notify = function(){
                            notify.apply(this, arguments);
                            object.success.apply(this, arguments);
                        };
                    } else {
                        options.notify = notify;
                    }
                }
            } else {
                if (!options.notify && object && object.success) {
                    options.notify = object.success;
                }
            }
            return options;
        },

        // pass options to inner methods
        _inner: function(options, override){
            return $.extend({}, options, {
                success: null,
                fail: null,
                notify: null
            }, override);
        },

        // trigger event
        _trigger: function(item, eventName, options){
            var event = $.Event('acitree');
            if (!options){
                options = this._options();
            }
            this._instance.jQuery.trigger(event, [this, item ? item.first() : null, eventName, options]);
            return !event.isDefaultPrevented();
        },

        // call on success
        _success: function(item, options){
            if (options && options.success){
                options.success.call(this, item ? item.first() : null, options);
            }
        },

        // call on fail
        _fail: function(item, options){
            if (options && options.fail){
                options.fail.call(this, item ? item.first() : null, options);
            }
        },

        // call on notify (should be same as 'success' but called when already in the requested state)
        _notify: function(item, options){
            if (options && options.notify){
                options.notify.call(this, item ? item.first() : null, options);
            }
        },

        // delay callback on busy item
        _delayBusy: function(item, callback){
            if ((this._private.delayBusy < 10) && this.isBusy(item)){
                this._private.delayBusy++;
                var _private = this._private;
                setTimeout($.proxy(function(){
                    this._delayBusy.call(this, item, callback);
                    _private.delayBusy--;
                }, this), 10);
                return;
            }
            callback.apply(this);
        },

        // process item loading with AJAX
        // loaded data need to be array of item objects
        // each item can have childrens (defined as itemData.childs - array of item objects)
        ajaxLoad: function(item, options){
            if (item && this.isBusy(item)){
                this._delayBusy(item, function(){
                    this.ajaxLoad(item, options);
                });
                return;
            }
            options = this._options(options, function(){
                this._loading(item);
                this._trigger(item, 'loaded', options);
            }, function(){
                this._loading(item);
                this._trigger(item, 'loadfail', options);
            }, function(){
                this._loading(item);
                this._trigger(item, 'wasloaded', options);
            });
            if (!item || this.isFolder(item)){
                this._private.loadQueue.push(function(complete){
                    if (!this._trigger(item, 'beforeload', options)){
                        this._fail(item, options);
                        complete();
                        return;
                    }
                    this._loading(item, true);
                    if (this.wasLoad(item)){
                        this._notify(item, options);
                        complete();
                        return;
                    }
                    // loaded data need to be array of item objects
                    $.get(this._instance.options.jsonUrl + (item ? this.getId(item) : ''), $.proxy(function(itemList){
                        if (itemList && (itemList instanceof Array) && itemList.length){
                            var process = function(){
                                if (this.wasLoad(item)){
                                    this._notify(item, options);
                                    complete();
                                } else {
                                    this._createBranch(item, this._inner(options, {
                                        success: function(){
                                            this._success(item, options);
                                            complete();
                                        },
                                        fail: function(){
                                            this._fail(item, options);
                                            complete();
                                        },
                                        itemData: itemList
                                    }));
                                }
                            };
                            if (!item || this.isFolder(item)){
                                process.apply(this);
                            } else {
                                this.setFolder(item, this._inner(options, {
                                    success: process,
                                    fail: options.fail
                                }));
                            }
                        } else {
                            var process = function(){
                                this._fail(item, options);
                                complete();
                            };
                            if (!item || this.isFile(item)){
                                process.apply(this);
                            } else {
                                this.setFile(item, this._inner(options, {
                                    success: process,
                                    fail: process
                                }));
                            }
                        }
                    }, this), 'json').fail(function(){
                        this._fail(item, options);
                        complete();
                    });
                }, true).run();
            } else {
                this._fail(item, options);
            }
        },

        // process item loading
        // options.itemData need to be array of item objects
        // each item can have childrens (defined as itemData.childs - array of item objects)
        loadFrom: function(item, options){
            if (item && this.isBusy(item)){
                this._delayBusy(item, function(){
                    this.loadFrom(item, options);
                });
                return;
            }
            options = this._options(options, function(){
                this._loading(item);
                this._trigger(item, 'loaded', options);
            }, function(){
                this._loading(item);
                this._trigger(item, 'loadfail', options);
            }, function(){
                this._loading(item);
                this._trigger(item, 'wasloaded', options);
            });
            if (!item || this.isFolder(item)){
                if (!this._trigger(item, 'beforeload', options)){
                    this._fail(item, options);
                    return;
                }
                this._loading(item, true);
                if (this.wasLoad(item)){
                    this._notify(item, options);
                    return;
                }
                // data need to be array of item objects
                if (options.itemData && (options.itemData instanceof Array) && options.itemData.length){
                    var process = function(){
                        if (this.wasLoad(item)){
                            this._notify(item, options);
                        } else {
                            this._createBranch(item, options);
                        }
                    };
                    if (!item || this.isFolder(item)){
                        process.apply(this);
                    } else {
                        this.setFolder(item, this._inner(options, {
                            success: process,
                            fail: options.fail
                        }));
                    }
                } else {
                    if (!item || this.isFile(item)){
                        this._fail(item, options);
                    } else {
                        this.setFile(item, this._inner(options, {
                            success: options.fail,
                            fail: options.fail
                        }));
                    }
                }
            } else {
                this._fail(item, options);
            }
        },

        // unload item
        unload: function(item, options){
            var _this = this;
            options = this._options(options, function(){
                this._loading(item);
                this._trigger(item, 'unloaded', options);
            }, function(){
                this._loading(item);
                this._trigger(item, 'unloadfail', options);
            }, function(){
                this._loading(item);
                this._trigger(item, 'notloaded', options);
            });
            if (!item || this.isFolder(item)){
                if (!this._trigger(item, 'beforeunload', options)){
                    this._fail(item, options);
                    return;
                }
                this._loading(item, true);
                if (!this.wasLoad(item)){
                    this._notify(item, options);
                    return;
                }
                var cancel = false;
                var childs = this.childrens(item, true);
                childs.each(function(){
                    var item = $(this);
                    if (_this.isFolder(item)){
                        if (_this.isOpen(item)){
                            if (!_this._trigger(item, 'beforeclose', options)){
                                cancel = true;
                                return false;
                            }
                        }
                        if (_this.wasLoad(item)){
                            if (!_this._trigger(item, 'beforeunload', options)){
                                cancel = true;
                                return false;
                            }
                        }
                    }
                    if (!_this._trigger(item, 'beforeremove', options)){
                        cancel = true;
                        return false;
                    }
                });
                if (cancel){
                    this._fail(item, options);
                    return;
                }
                childs.each(function(){
                    var item = $(this);
                    if (_this.isFolder(item)){
                        if (_this.isOpen(item)){
                            _this._trigger(item, 'closed', options);
                        }
                        if (_this.wasLoad(item)){
                            _this._trigger(item, 'unloaded', options);
                        }
                    }
                    _this._trigger(item, 'removed', options);
                });
                if (item){
                    if (this.isOpen(item)){
                        this.close(item, this._inner(options, {
                            success: function(){
                                this._removeContainer(item);
                                this._success(item, options);
                            },
                            fail: options.fail
                        }));
                    } else {
                        this._removeContainer(item);
                        this._success(item, options);
                    }
                } else {
                    this._animate(item, false, !this._instance.options.animateRoot || options.unanimated, function(){
                        this._removeContainer();
                        this._success(item, options);
                    });
                }
            } else {
                this._fail(item, options);
            }
        },

        // remove item
        remove: function(item, options){
            options = this._options(options, function(){
                this._trigger(item, 'removed', options);
            }, function(){
                this._trigger(item, 'removefail', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforeremove', options)){
                    this._fail(item, options);
                    return;
                }
                if (this.isFolder(item) && this.wasLoad(item)){
                    this.unload(item, this._inner(options, {
                        success: function(){
                            this._success(item, options);
                            this._removeItem(item);
                        },
                        fail: options.fail
                    }));
                } else if (this.hasSiblings(item)){
                    this._success(item, options);
                    this._removeItem(item);
                } else {
                    var parent = this.parent(item);
                    this.unload(parent.length ? parent : null, this._inner(options, {
                        success: options.success,
                        fail: options.fail
                    }));
                }
            } else {
                this._fail(item, options);
            }
        },

        // open item childrens
        _openChilds: function(item, options){
            if (options.expand){
                var queue = new this._queue(this._instance.options.threads, true).context(this);
                this.folders(this.childrens(item)).each(function(){
                    var item = $(this);
                    queue.push(function(complete){
                        this.open(item, this._inner(options, {
                            success: complete,
                            fail: complete
                        }));
                    }, true);
                });
                queue.complete(function(){
                    this._success(item, options);
                }).run(true);
            } else {
                this._success(item, options);
            }
        },

        // process item open
        _openItem: function(item, options){
            if (!options.unanimated && !this.isVisible(item)){
                options.unanimated = true;
            }
            if (options.unique){
                this.closeOthers(item);
                options.unique = false;
            }
            item.first().addClass('aciTreeOpen');
            this._updateOddEvenChilds(item);
            this._animate(item, true, options.unanimated, function(){
                this._openChilds(item, options);
            });
        },

        // open item and his childs if requested
        open: function(item, options){
            options = this._options(options, function(){
                if (this.isOpenPath(item)){
                    this._updateVisible(item, true);
                    this._updateOddEven(item);
                }
                this._trigger(item, 'opened', options);
            }, function(){
                this._trigger(item, 'openfail', options);
            }, function(){
                this._trigger(item, 'wasopened', options);
            });
            if (this.isFolder(item)){
                if (!this._trigger(item, 'beforeopen', options)){
                    this._fail(item, options);
                    return;
                }
                if (this.isOpen(item)){
                    options.success = options.notify;
                    this._openChilds(item, options);
                } else {
                    if (this.wasLoad(item)){
                        this._openItem(item, options);
                    } else {
                        this.ajaxLoad(item, this._inner(options, {
                            success: function(){
                                this._openItem(item, options);
                            },
                            fail: options.fail
                        }));
                    }
                }
            } else {
                this._fail(item, options);
            }
        },

        // close item childrens
        _closeChilds: function(item, options){
            if (this._instance.options.empty){
                options.unanimated = true;
                this.unload(item, options);
            } else if (options.collapse){
                var queue = new this._queue(this._instance.options.threads, true).context(this);
                this.folders(this.childrens(item)).each(function(){
                    var item = $(this);
                    queue.push(function(complete){
                        this.close(item, this._inner(options, {
                            success: complete,
                            fail: complete,
                            unanimated: true
                        }));
                    }, true);
                });
                queue.complete(function(){
                    this._success(item, options);
                }).run(true);
            } else {
                this._success(item, options);
            }
        },

        // process item close
        _closeItem: function(item, options){
            if (!options.unanimated && !this.isVisible(item)){
                options.unanimated = true;
            }
            item.first().removeClass('aciTreeOpen');
            this._animate(item, false, options.unanimated, function(){
                this._closeChilds(item, options);
            });
        },

        // close item and his childs if requested
        close: function(item, options){
            options = this._options(options, function(){
                if (this.isOpenPath(item)){
                    this._updateVisible(item, false);
                    this._updateOddEven(item);
                }
                this._trigger(item, 'closed', options);
            }, function(){
                this._trigger(item, 'closefail', options);
            }, function(){
                this._trigger(item, 'wasclosed', options);
            });
            if (this.isFolder(item)){
                if (!this._trigger(item, 'beforeclose', options)){
                    this._fail(item, options);
                    return;
                }
                if (this.isOpen(item)){
                    this._closeItem(item, options);
                } else if (this.wasLoad(item)){
                    options.success = options.notify;
                    this._closeChilds(item, options);
                } else {
                    this._notify(item, options);
                }
            } else {
                this._fail(item, options);
            }
        },

        // update visible state
        _updateVisible: function(item, state){
            var _this = this;
            var childs = this.childrens(item);
            if (state){
                this.folders(childs, true).each(function(){
                    var item = $(this);
                    if (!item.hasClass('aciTreeVisible')){
                        _this._updateVisible(item, true);
                    }
                });
                childs.addClass('aciTreeVisible');
            } else {
                this.folders(childs, true).each(function(){
                    var item = $(this);
                    if (item.hasClass('aciTreeVisible')){
                        _this._updateVisible(item, false);
                    }
                });
                childs.removeClass('aciTreeVisible');
            }
        },

        // keep just one branch open
        closeOthers: function(item, options){
            options = this._options(options);
            if (this.isItem(item)){
                var queue = new this._queue(this._instance.options.threads, true).context(this);
                var exclude = item.first().add(this.path(item)).add(this.childrens(item, true));
                this.folders(this.childrens(null, true), true).not(exclude).each(function(){
                    var item = $(this);
                    queue.push(function(complete){
                        this.close(item, this._inner(options, {
                            success: complete,
                            fail: complete
                        }));
                    }, true);
                });
                queue.complete(function(){
                    this._success(item, options);
                }).run(true);
            } else {
                this._fail(item, options);
            }
        },

        // toggle item
        toggle: function(item, options){
            options = this._options(options, function(){
                this._trigger(item, 'toggled', options);
            }, function(){
                this._trigger(item, 'togglefail', options);
            });
            if (this.isFolder(item)){
                if (!this._trigger(item, 'beforetoggle', options)){
                    this._fail(item, options);
                    return;
                }
                if (this.isOpen(item)){
                    this.close(item, options);
                } else {
                    this.open(item, options);
                }
            } else {
                this._fail(item, options);
            }
        },

        // get item path (starting from top parent)
        // when 'reverse' is TRUE returns the path in reverse order
        path: function(item, reverse){
            if (item){
                var path = item.first().parentsUntil(this._instance.jQuery, '.aciTreeLi');
                return reverse ? path : $(path.get().reverse());
            }
            return $([]);
        },

        // test if item is in view
        isVisible: function(item){
            if (this.isOpenPath(item)){
                var rect = this._instance.jQuery.get(0).getBoundingClientRect();
                var size = item.first().children('.aciTreeLine').find('.aciTreeItem');
                var test = size.get(0).getBoundingClientRect();
                var height = size.outerHeight(true);
                if ((test.bottom - height < rect.top) || (test.top + height > rect.bottom) || (test.right < rect.left) || (test.left > rect.right)){
                    // is out of view
                    return false;
                }
                return true;
            }
            return false;
        },

        // open path to item
        openPath: function(item, options){
            options = this._options(options);
            if (this.isItem(item)){
                var queue = new this._queue(null, true).context(this);
                this.folders(this.path(item), false).each(function(){
                    var item = $(this);
                    queue.push(function(complete){
                        this.open(item, this._inner(options, {
                            success: complete,
                            fail: complete
                        }));
                    }, true);
                });
                queue.complete(function(){
                    this._success(item, options);
                }).run();
            } else {
                this._fail(item, options);
            }
        },

        // test if path to item is open
        isOpenPath: function(item){
            return item && item.hasClass('aciTreeVisible');
        },

        // get animation speed by element size
        _speedFraction: function(speed, totalSize, required){
            if ((required < totalSize) && totalSize){
                var numeric = parseInt(speed);
                if (isNaN(numeric)){
                    switch (speed){
                        case 'slow':
                            numeric = 600;
                            break;
                        case 'medium':
                            numeric = 400;
                            break;
                        case 'fast':
                            numeric = 200;
                            break;
                        default:
                            return speed;
                    }
                }
                return numeric * required / totalSize;
            }
            return speed;
        },

        // bring item in view
        setVisible: function(item, options){
            options = this._options(options, function(){
                this._trigger(item, 'visible', options);
            }, function(){
                this._trigger(item, 'visiblefail', options);
            }, function(){
                this._trigger(item, 'wasvisible', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforevisible', options)){
                    this._fail(item, options);
                    return;
                }
                if (this.isVisible(item)){
                    this._notify(item, options);
                    return;
                }
                var process = function(){
                    var rect = this._instance.jQuery.get(0).getBoundingClientRect();
                    var size = item.first().children('.aciTreeLine').find('.aciTreeItem');
                    var test = size.get(0).getBoundingClientRect();
                    var height = size.outerHeight(true);
                    if (test.bottom - height < rect.top){
                        var diff = rect.top - test.bottom + height;
                        if (!options.unanimated && this._instance.options.view){
                            this._instance.jQuery.stop(true).animate({
                                scrollTop: this._instance.jQuery.scrollTop() - diff
                            }, {
                                duration: this._speedFraction(this._instance.options.view.duration, rect.bottom - rect.top, diff),
                                easing: this._instance.options.view.easing,
                                complete: $.proxy(function(){
                                    this._success(item, options);
                                }, this)
                            });
                        } else {
                            this._instance.jQuery.stop(true).get(0).scrollTop = this._instance.jQuery.scrollTop() - diff;
                            this._success(item, options);
                        }
                    } else if (test.top + height > rect.bottom){
                        var diff = test.top - rect.bottom + height;
                        if (!options.unanimated && this._instance.options.view){
                            this._instance.jQuery.stop(true).animate({
                                scrollTop: this._instance.jQuery.scrollTop() + diff
                            }, {
                                duration: this._speedFraction(this._instance.options.view.duration, rect.bottom - rect.top, diff),
                                easing: this._instance.options.view.easing,
                                complete: $.proxy(function(){
                                    this._success(item, options);
                                }, this)
                            });
                        } else {
                            this._instance.jQuery.stop(true).get(0).scrollTop = this._instance.jQuery.scrollTop() + diff;
                            this._success(item, options);
                        }
                    } else {
                        this._success(item, options);
                    }
                };
                if (this.hasParent(item)){
                    this.openPath(item, this._inner(options, {
                        success: process,
                        fail: options.fail
                    }));
                } else {
                    process.apply(this);
                }
            } else {
                this._fail(item, options);
            }
        },

        // test if item has parent
        hasParent: function(item){
            return item && (item.first().parent().parent('.aciTreeLi').length > 0);
        },

        // get item parent
        parent: function(item){
            return item ? item.first().parent().parent('.aciTreeLi') : $([]);
        },

        // get item top parent
        topParent: function(item){
            return this.path(item).eq(0);
        },

        // create tree branch
        // options.itemData need to be the same as for .append
        _createBranch: function(item, options){
            var _this = this;
            var queue = new this._queue(this._instance.options.threads, true).context(this);
            var process = function (item, itemList){
                if (item){
                    item.first().removeClass('aciTreeFolderMaybe').addClass('aciTreeFolder');
                }
                _this.append(item, _this._inner(options, {
                    success: function(item, options){
                        var itemData;
                        for(var i in options.itemData){
                            itemData = options.itemData[i];
                            // childs need to be array of item objects
                            if (itemData.childs && (itemData.childs instanceof Array) && itemData.childs.length){
                                (function(item, itemData){
                                    queue.push(function(complete){
                                        process(item, itemData.childs);
                                        if (itemData.open){
                                            _this.open(item);
                                        }
                                        complete();
                                    }, true);
                                })(options.items.eq(i), itemData);
                            } else if (itemData.open){
                                _this.open(options.items.eq(i), _this._inner(options));
                            }
                        }
                    },
                    fail: options.fail,
                    itemData: itemList
                }));
            };
            queue.push(function(complete){
                process(item, options.itemData);
                complete();
            }, true).complete(function(){
                _this._success(item, options);
            }).run(true);
        },

        // update first/last state position
        _updateFirstLast: function(parent, items){
            if (items){
                items.removeClass('aciTreeFirst aciTreeLast');
            }
            this.first(parent).addClass('aciTreeFirst');
            this.last(parent).addClass('aciTreeLast');
        },

        _setOddEven: function(items, odd){
            items.filter(':odd').removeClass(odd ? 'aciTreeEven' : 'aciTreeOdd').addClass(odd ? 'aciTreeOdd' : 'aciTreeEven');
            items.filter(':even').removeClass(odd ? 'aciTreeOdd' : 'aciTreeEven').addClass(odd ? 'aciTreeEven' : 'aciTreeOdd');
        },

        // update odd/even row state
        _updateOddEven: function(items){
            var visible = this._instance.jQuery.find('.aciTreeVisible');
            var index = 0;
            if (items){
                items.each(function(){
                    var found = visible.index(this);
                    if (found != -1){
                        index = Math.min(found, index);
                    }
                });
                index = Math.max(index - 1, 0);
            }
            var odd = true;
            if (index > 0){
                var first = visible.eq(index);
                if (first.hasClass('aciTreOdd')){
                    odd = false;
                }
                visible = visible.filter(':gt(' + index + ')');
            }
            this._setOddEven(visible, odd);
        },

        // update odd/even row state
        _updateOddEvenChilds: function(item){
            var odd = item.hasClass('aciTreeOdd');
            var childs = this.childrens(item);
            this._setOddEven(childs, odd);
        },

        // process item before inserting into the DOM
        _itemHook: function(parent, item, itemData, level){
            if (this._instance.options.callbacks && this._instance.options.callbacks.item){
                this._instance.options.callbacks.item.call(this, parent, item, itemData, level);
            }
        },

        _createItem: function(itemData, level){
            var item = $('<li class="aciTreeLi aciTreeLevel' + level + '"></li>').data('itemData' + this._instance.nameSpace, $.extend({}, itemData, {
                childs: itemData.childs && itemData.childs.length
            }));
            var start = '<div class="aciTreeLine">', end = '';
            for(var i = 0; i < level; i++){
                start += '<div class="aciTreeBranch aciTreeLevel' + i + '">';
                end += '</div>';
            }
            start += '<div class="aciTreeEntry"><span class="aciTreeButton"><span></span></span><span class="aciTreeItem">';
            if (itemData.icon){
                if (itemData.icon instanceof Array){
                    start += '<span class="aciTreeIcon ' + itemData.icon[0] + '" style="background-position:' +
                    itemData.icon[1] + 'px ' + itemData.icon[2] + 'px' + '"></span>';
                } else {
                    start += '<span class="aciTreeIcon ' + itemData.icon + '"></span>';
                }
            }
            item.append(start + '<span class="aciTreeText">' + itemData.label + '</span></span></div>' + end + '</div>');
            if (itemData.isFolder || (itemData.isFolder === null)){
                item.addClass((itemData.isFolder || (itemData.childs && itemData.childs.length)) ? 'aciTreeFolder' : 'aciTreeFolderMaybe');
            } else {
                item.addClass('aciTreeFile');
            }
            return item;
        },

        // remove item
        _removeItem: function(item){
            var parent = this.parent(item);
            item.first().remove();
            this._updateFirstLast(parent.length ? parent : null);
        },

        // create/add one or more items
        _createItems: function(ul, before, after, itemData, level){
            if (itemData){
                var parent;
                if (ul){
                    parent = this.itemFrom(ul);
                } else if (before){
                    parent = this.parent(before);
                } else if (after){
                    parent = this.parent(after);
                }
                var items = [], item;
                if (itemData instanceof Array){
                    for(var i in itemData){
                        item = this._createItem(itemData[i], level);
                        this._itemHook(parent, item, itemData[i], level);
                        items[items.length] = item.get(0);
                    }
                } else {
                    item = this._createItem(itemData, level);
                    this._itemHook(parent, item, itemData, level);
                    items[items.length] = item.get(0);
                }
                items = $(items);
                if (ul){
                    ul.append(items);
                } else if (before){
                    before.first().before(items);
                } else if (after){
                    after.first().after(items);
                }
                return items;
            }
            return $([]);
        },

        // create children container
        _createContainer: function(item){
            if (!item){
                item = this._instance.jQuery;
            }
            var container = item.first().children('.aciTreeUl');
            if (!container.length){
                container = $('<ul class="aciTreeUl" style="display:none"></ul>');
                item.first().append(container);
            }
            return container;
        },

        // remove children container
        _removeContainer: function(item){
            if (!item){
                item = this._instance.jQuery;
            }
            item.first().children('.aciTreeUl').remove();
        },

        // append one or more items to item
        // options.itemData can be a item object or array of item objects
        // options.items will keep a list of added items
        append: function(item, options){
            var _this = this;
            options = this._options(options, function(){
                this._trigger(item, 'appended', options);
            }, function(){
                this._trigger(item, 'appendfail', options);
            });
            if (item){
                if (this.isFolder(item)){
                    if (!this._trigger(item, 'beforeappend', options)){
                        this._fail(item, options);
                        return;
                    }
                    var last = this.last(item);
                    var container = this._createContainer(item);
                    var list = this._createItems(container, null, null, options.itemData, this.level(item) + 1);
                    if (list.length){
                        item.first().addClass('aciTreeFolder').removeClass('aciTreeFolderMaybe');
                        if (last.length){
                            last.removeClass('aciTreeLast');
                        } else {
                            list.first().addClass('aciTreeFirst');
                            list.last().addClass('aciTreeLast');
                        }
                        if (this.isOpenPath(item) && this.isOpen(item)){
                            list.addClass('aciTreeVisible');
                        }
                        this._updateOddEven(list.first());
                        list.each(function(){
                            _this._trigger($(this), 'added', options);
                        });
                    } else if (!this.hasChildrens(item)){
                        container.remove();
                    }
                    options.items = list;
                    this._success(item, options);
                } else {
                    this._fail(item, options);
                }
            } else {
                if (!this._trigger(item, 'beforeappend', options)){
                    this._fail(item, options);
                    return;
                }
                var last = this.last();
                var container = this._createContainer();
                var list = this._createItems(container, null, null, options.itemData, 0);
                if (list.length){
                    if (last.length){
                        last.removeClass('aciTreeLast');
                    } else {
                        list.first().addClass('aciTreeFirst');
                        list.last().addClass('aciTreeLast');
                    }
                    list.addClass('aciTreeVisible').last().addClass('aciTreeLast');
                    this._updateOddEven();
                    list.each(function(){
                        _this._trigger($(this), 'added', options);
                    });
                    this._animate(null, true, !this._instance.options.animateRoot || options.unanimated);
                } else if (!this.hasChildrens()){
                    container.remove();
                }
                options.items = list;
                this._success(item, options);
            }
        },

        // insert one or more items before item
        // options.itemData can be a item object or array of item objects
        // options.items will keep a list of added items
        before: function(item, options){
            var _this = this;
            options = this._options(options, function(){
                this._trigger(item, 'before', options);
            }, function(){
                this._trigger(item, 'beforefail', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforebefore', options)){
                    this._fail(item, options);
                    return;
                }
                var prev = this.prev(item);
                var list = this._createItems(null, item.first(), null, options.itemData, this.level(item));
                if (list.length){
                    if (!prev.length){
                        item.first().removeClass('aciTreeFirst');
                        list.first().addClass('aciTreeFirst');
                    }
                    if (this.isOpenPath(item)){
                        list.addClass('aciTreeVisible');
                    }
                    this._updateOddEven(list.first());
                    list.each(function(){
                        _this._trigger($(this), 'added', options);
                    });
                }
                options.items = list;
                this._success(item, options);
            } else {
                this._fail(item, options);
            }
        },

        // insert one or more items after item
        // options.itemData can be a item object or array of item objects
        // options.items will keep a list of added items
        after: function(item, options){
            var _this = this;
            options = this._options(options, function(){
                this._trigger(item, 'after', options);
            }, function(){
                this._trigger(item, 'afterfail', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforeafter', options)){
                    this._fail(item, options);
                    return;
                }
                var next = this.next(item);
                var list = this._createItems(null, null, item.first(), options.itemData, this.level(item));
                if (list.length){
                    if (!next.length){
                        item.first().removeClass('aciTreeLast');
                        list.last().addClass('aciTreeLast');
                    }
                    if (this.isOpenPath(item)){
                        list.addClass('aciTreeVisible');
                    }
                    this._updateOddEven(list.first());
                    list.each(function(){
                        _this._trigger($(this), 'added', options);
                    });
                }
                options.items = list;
                this._success(item, options);
            } else {
                this._fail(item, options);
            }
        },

        // get item having the element
        itemFrom: function(element){
            if (element){
                var item = $(element).first();
                if (item.get(0) == this._instance.jQuery.get(0)){
                    return $([]);
                } else if (item.hasClass('aciTreeLi')){
                    return item;
                } else {
                    return item.parents('.aciTreeLi:first');
                }
            }
            return $([]);
        },

        // get item childrens
        // if 'branch' is TRUE then all childrens are returned
        childrens: function(item, branch){
            if (!item){
                item = this._instance.jQuery;
            }
            return branch ? item.first().find('.aciTreeLi') : item.first().children('.aciTreeUl').children('.aciTreeLi');
        },

        // filter only the visible items (items with all parents opened)
        // if 'view' is TRUE then only the items in view are returned
        visible: function(items, view){
            var _this = this;
            items = items.filter('.aciTreeVisible');
            if (view){
                var visible = $.grep(items.get(), function(item){
                    return _this.isVisible($(item));
                });
                items = $(visible);
            }
            return items;
        },

        // filter only folders from items
        // if state is set then filter only open/closed ones
        folders: function(items, state){
            if (typeof state != 'undefined'){
                if (state){
                    return items.filter('.aciTreeOpen');
                } else {
                    return items.filter('.aciTreeFolder,.aciTreeFolderMaybe').not('.aciTreeOpen');
                }
            }
            return items.filter('.aciTreeFolder,.aciTreeFolderMaybe');
        },

        // filter only files from items
        files: function(items){
            return items.filter('.aciTreeFile');
        },

        // test if item is a folder
        isFolder: function(item){
            return item && (item.first().hasClass('aciTreeFolder') || item.first().hasClass('aciTreeFolderMaybe'));
        },

        // test if item is a file
        isFile: function(item){
            return item && item.first().hasClass('aciTreeFile');
        },

        // test if item was loaded
        wasLoad: function(item){
            if (!item){
                return this._instance.jQuery.children('.aciTreeUl').length > 0;
            }
            if (this.isFolder(item)){
                return item.first().children('.aciTreeUl').length > 0;
            }
            return true;
        },

        // set item as folder
        setFolder: function(item, options){
            options = this._options(options, function(){
                this._trigger(item, 'folderset', options);
            }, function(){
                this._trigger(item, 'folderfail', options);
            }, function(){
                this._trigger(item, 'wasfolder', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforefolder', options)){
                    this._fail(item, options);
                    return;
                }
                if (this.isFile(item)){
                    item.first().removeClass('aciTreeFile').addClass('aciTreeFolder');
                    this._success(item, options);
                } else {
                    this._notify(item, options);
                }
            } else {
                this._fail(item, options);
            }
        },

        // set item as file
        setFile: function(item, options){
            options = this._options(options, function(){
                this._trigger(item, 'fileset', options);
            }, function(){
                this._trigger(item, 'filefail', options);
            }, function(){
                this._trigger(item, 'wasfile', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforefile', options)){
                    this._fail(item, options);
                    return;
                }
                if (this.isFolder(item)){
                    var process = function(){
                        item.first().removeClass('aciTreeFolder aciTreeFolderMaybe aciTreeOpen').addClass('aciTreeFile');
                        this._success(item, options);
                    };
                    if (this.wasLoad(item)){
                        this.unload(item, this._inner(options, {
                            success: process,
                            fail: options.fail
                        }));
                    } else {
                        process.apply(this);
                    }
                } else {
                    this._notify(item, options);
                }
            } else {
                this._fail(item, options);
            }
        },

        // set the icon for item
        // options.icon - CSS class name or Array [class name, background x position, background y position]
        // options.oldIcon will keep the old icon
        setIcon: function(item, options){
            options = this._options(options, null, function(){
                this._trigger(item, 'iconfail', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforeicon', options)){
                    this._fail(item, options);
                    return;
                }
                var icon = options.icon;
                var itemData = this.itemData(item);
                options.oldIcon = itemData.icon;
                var parent = item.first().children('.aciTreeLine').find('.aciTreeItem');
                var found = parent.children('.aciTreeIcon');
                if (found.length){
                    if (icon){
                        if (icon instanceof Array){
                            found.attr('class', 'aciTreeIcon ' + icon[0]).css('background-position', icon[1] + 'px ' + icon[2] + 'px');
                        } else {
                            found.attr('class', 'aciTreeIcon ' + icon);
                        }
                        itemData.icon = icon;
                        this._trigger(item, 'iconset', options);
                    } else {
                        found.remove();
                        itemData.icon = null;
                        this._trigger(item, 'iconremoved', options);
                    }
                } else if (icon){
                    if (icon instanceof Array){
                        parent.prepend('<div class="aciTreeIcon ' + icon[0] + '" style="background-position:' +
                            icon[1] + 'px ' + icon[2] + 'px' + '"></div>');
                    } else {
                        parent.prepend('<div class="aciTreeIcon ' + icon + '"></div>');
                    }
                    itemData.icon = icon;
                    this._trigger(item, 'iconadded', options);
                } else {
                    this._trigger(item, 'noticon', options);
                }
                this._success(item, options);
            } else {
                this._fail(item, options);
            }
        },

        // get item icon
        getIcon: function(item){
            var itemData = this.itemData(item);
            return itemData ? itemData.icon : null;
        },

        // set item label
        // options.label is the new label
        // options.oldLabel will keep the old label
        setLabel: function(item, options){
            options = this._options(options, null, function(item, options){
                this._trigger(item, 'labelfail', options);
            }, function(){
                this._trigger(item, 'waslabel', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforelabel', options)){
                    this._fail(item, options);
                    return;
                }
                var label = options.label;
                var itemData = this.itemData(item);
                options.oldLabel = itemData.label;
                if (label == options.oldLabel){
                    this._notify(item, options);
                } else {
                    item.first().children('.aciTreeLine').find('.aciTreeText').html(label);
                    itemData.label = label;
                    this._trigger(item, 'labelset', options);
                    this._success(item, options);
                }
            } else {
                this._fail(item, options);
            }
        },

        // test if item is open
        isOpen: function(item){
            return item && item.first().hasClass('aciTreeOpen');
        },

        // test if item is closed
        isClosed: function(item){
            return !this.isOpen(item);
        },

        // test if item has childrens
        hasChildrens: function(item){
            if (!item){
                item = this._instance.jQuery;
            }
            return item.first().children('.aciTreeUl').children('.aciTreeLi:first').length > 0;
        },

        // test if item has siblings
        hasSiblings: function(item){
            return item && (item.first().siblings('.aciTreeLi:first').length > 0);
        },

        // test if item has another before
        hasPrev: function(item){
            return this.prev(item).length > 0;
        },

        // test if item has another after
        hasNext: function(item){
            return this.next(item).length > 0;
        },

        // get item siblings
        siblings: function(item){
            return item ? item.first().siblings('.aciTreeLi') : $([]);
        },

        // get previous item
        prev: function(item){
            return item ? item.first().prev('.aciTreeLi') : $([]);
        },

        // get next item
        next: function(item){
            return item ? item.first().next('.aciTreeLi') : $([]);
        },

        // get item level (starting from 0)
        // return -1 for invalid items
        level: function(item){
            var level = -1;
            if (item){
                item = item.first();
                while (item.hasClass('aciTreeLi')){
                    item = item.parent().parent();
                    level++;
                }
            }
            return level;
        },

        // get item ID
        getId: function(item){
            var itemData = this.itemData(item);
            return itemData ? itemData.id : null;
        },

        // get item data
        itemData: function(item){
            return item ? item.first().data('itemData' + this._instance.nameSpace) : null;
        },

        // set item ID
        // options.id is the new item ID
        // options.oldId will keep the old ID
        setId: function(item, options){
            options = this._options(options, null, function(){
                this._trigger(item, 'idfail', options);
            }, function(){
                this._trigger(item, 'wasid', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforeid', options)){
                    this._fail(item, options);
                    return;
                }
                var id = options.id;
                var itemData = this.itemData(item);
                options.oldId = itemData.id;
                if (id ==  options.oldId){
                    this._notify(item, options);
                } else {
                    itemData.id = id;
                    this._trigger(item, 'idset', options);
                    this._success(item, options);
                }
            } else {
                this._fail(item, options);
            }
        },

        // get item index starting from 0
        getIndex: function(item){
            return item ? item.first().parent().children('.aciTreeLi').index(item.first()) : null;
        },

        // set item 0 based index
        // options.index is the new index
        // options.oldIndex will keep the old index
        setIndex: function(item, options){
            var index = options.index;
            options = this._options(options, null, function(){
                this._trigger(item, 'indexfail', options);
            }, function(){
                this._trigger(item, 'wasindex', options);
            });
            if (this.isItem(item)){
                if (!this._trigger(item, 'beforeindex', options)){
                    this._fail(item, options);
                    return;
                }
                options.oldIndex = this.getIndex(item);
                var siblings = this.siblings(item);
                if ((index != options.oldIndex) && siblings.length) {
                    if (index < 1){
                        siblings.first().before(item);
                    } else if (index >= siblings.length){
                        siblings.last().after(item);
                    } else {
                        siblings.eq(index).before(item);
                    }
                    var parent = this.parent(item);
                    this._updateFirstLast(parent.length ? parent : null, item.add([siblings.get(0), siblings.get(-1)]));
                    this._updateOddEven(parent);
                    this._trigger(item, 'indexset', options);
                    this._success(item, options);
                } else {
                    this._notify(item, options);
                }
            } else {
                this._fail(item, options);
            }
        },

        // get item label
        getLabel: function(item){
            var itemData = this.itemData(item);
            return itemData ? itemData.label : null;
        },

        // test if it's a valid item
        isItem: function(item){
            return item && item.first().hasClass('aciTreeLi');
        },

        // item animation
        _animate: function(item, state, unanimated, callback){
            if (!item){
                item = this._instance.jQuery;
            }
            if (!unanimated){
                var type = state ? this._instance.options.show : this._instance.options.hide;
                if (type) {
                    var ul = item.first().children('.aciTreeUl');
                    if (ul.length){
                        ul.stop(true, true).animate(type.props, {
                            duration: type.duration,
                            easing: type.easing,
                            complete: $.proxy(callback, this)
                        });
                    } else if (callback){
                        callback.apply(this);
                    }
                    return;
                }
            }
            item.first().children('.aciTreeUl').stop(true, true).toggle(state);
            if (callback){
                callback.apply(this);
            }
        },

        // get first child of item
        first: function(item){
            if (!item){
                item = this._instance.jQuery;
            }
            return item.first().children('.aciTreeUl').children('.aciTreeLi:first');
        },

        // test if item is the first one for it's parent
        isFirst: function(item){
            if (item){
                var parent = this.parent(item);
                return this.first(parent.length ? parent : null).is(item.first());
            }
            return false;
        },

        // get last child of item
        last: function(item){
            if (!item){
                item = this._instance.jQuery;
            }
            return item.first().children('.aciTreeUl').children('.aciTreeLi:last');
        },

        // test if item is the last one for it's parent
        isLast: function(item){
            if (item){
                var parent = this.parent(item);
                return this.last(parent.length ? parent : null).is(item.first());
            }
            return false;
        },

        // test if item is loading
        isBusy: function(item){
            if (item){
                return item.first().hasClass('aciTreeLoad');
            } else {
                return !this._private.loadQueue.empty();
            }
        },

        // set loading state
        _loading: function(item, state){
            if (item){
                item.first().toggleClass('aciTreeLoad', state);
            } else if (state){
                this._loader(state);
            }
        },

        // show loader image
        _loader: function(show){
            var _this = this;
            if (show || this.isBusy()){
                if (!this._private.loaderInterval){
                    this._private.loaderInterval = setInterval(function(){
                        _this._loader();
                    }, this._instance.options.loaderDelay);
                }
                this._instance.jQuery.toggleClass('aciTreeLoad', true);
                clearTimeout(this._private.loaderHide);
                this._private.loaderHide = setTimeout(function(){
                    _this._instance.jQuery.toggleClass('aciTreeLoad', false);
                }, this._instance.options.loaderDelay * 2);
            }
        },

        // test if parent has children
        isChildren: function(parent, children){
            if (!parent){
                parent = this._instance.jQuery;
            }
            return children && (parent.has(children).length > 0);
        },

        // test if parent has immediate children
        isImmediateChildren: function(parent, children){
            if (!parent){
                parent = this._instance.jQuery;
            }
            return children && parent.children('.aciTreeUl').children('.aciTreeLi').is(children);
        },

        // test if items share the same parent
        sameParent: function(item1, item2){
            if (item1 && item2){
                var parent1 = this.parent(item1);
                var parent2 = this.parent(item2);
                return (!parent1.length && !parent2.length) || (parent1.get(0) == parent2.get(0));
            }
            return false;
        },

        // test if items share the same top parent
        sameTopParent: function(item1, item2){
            if (item1 && item2){
                var parent1 = this.topParent(item1);
                var parent2 = this.topParent(item2);
                return (!parent1.length && !parent2.length) || (parent1.get(0) == parent2.get(0));
            }
            return false;
        },

        // destroy control
        destroy: function(options){
            options = this._options(options);
            if (!this.wasInit()){
                this._trigger(null, 'notinit', options);
                this._fail(null, options);
                return;
            }
            if (this.isLocked()){
                this._trigger(null, 'locked', options);
                this._fail(null, options);
                return;
            }
            if (!this._trigger(null, 'beforedestroy', options)){
                this._trigger(null, 'destroyfail', options);
                this._fail(null, options);
                return;
            }
            this._instance.locked = true;
            this._instance.jQuery.toggleClass('aciTreeLoad', true);
            this._private.loadQueue.destroy();
            this._destroyHook(false);
            // we keep the _super reference
            var _super = this._super;
            this.unload(null, this._inner(options, {
                success: function(){
                    clearTimeout(this._private.loaderHide);
                    clearInterval(this._private.loaderInterval);
                    this._destroyHook(true);
                    this._instance.jQuery.unbind(this._instance.nameSpace).off(this._instance.nameSpace, '.aciTreeButton').off(this._instance.nameSpace, '.aciTreeLine');
                    this._instance.jQuery.toggleClass('aciTreeLoad', false);
                    this._instance.locked = false;
                    // call the parent
                    _super.apply(this);
                    this._trigger(null, 'destroyed', options);
                    this._success(null, options);
                },
                fail: function(){
                    this._instance.jQuery.toggleClass('aciTreeLoad', false);
                    this._instance.locked = false;
                    this._trigger(null, 'destroyfail', options);
                    this._fail(null, options);
                }
            }));
        },

        _destroyHook: function(unloaded){
        // override this to do extra destroy before/after unload
        }

    };

    // extend the base aciPluginUi class and store into aciPluginClass.plugins
    aciPluginClass.plugins.aciTree = aciPluginClass.aciPluginUi.extend(aciTree_core, 'aciTreeCore');

    // publish the plugin & the default options
    aciPluginClass.publish('aciTree', options);

})(jQuery);